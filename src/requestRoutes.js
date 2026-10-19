const express = require("express");
const pool = require("./db");

const router = express.Router();
router.param("id", (request, response, next, id) => {
  if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 2147483647n) {
    return response
      .status(400)
      .json({ error: "Request id must be a positive integer" });
  }
  next();
});
const statuses = [
  "pending_manager",
  "pending_accounts",
  "approved",
  "rejected",
  "cancelled",
];
const categories = [
  "Materials",
  "Labour",
  "Transport",
  "Equipment rental",
  "Other",
];
const maxAmountPaise = 50000000n;
const accountApprovalThresholdPaise = 5000000n;

const requestSelect = `
  SELECT orders.id, orders.project_id AS "projectId", projects.name AS "projectName",
         orders.raised_by_id AS "raisedById", people.name AS "raisedByName",
         people.email AS "raisedByEmail", people.role AS "raisedByRole",
         orders.category, orders.amount_inr AS amount,
         orders.company_funded_inr AS "companyFunded",
         orders.description, orders.status, orders.created_at AS "createdAt"
  FROM project_orders AS orders
  JOIN projects ON projects.id = orders.project_id
  JOIN people ON people.id = orders.raised_by_id
`;

function publicRequest(row) {
  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    projectName: row.projectName,
    raisedBy: {
      id: Number(row.raisedById),
      name: row.raisedByName,
      email: row.raisedByEmail,
      role: row.raisedByRole,
    },
    category: row.category,
    amount: String(row.amount),
    companyFunded: String(row.companyFunded),
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
  };
}

async function getRequest(client, id) {
  const { rows } = await client.query(`${requestSelect} WHERE orders.id = $1`, [
    id,
  ]);
  return rows[0];
}

async function getDetails(client, id) {
  const row = await getRequest(client, id);
  if (!row) return null;

  const { rows: history } = await client.query(
    `SELECT history.id, history.action, history.from_status AS "fromStatus",
            history.to_status AS "toStatus", history.reason,
            history.created_at AS "createdAt", people.name AS "actorName"
     FROM request_history AS history
     JOIN people ON people.id = history.actor_id
     WHERE history.request_id = $1
     ORDER BY history.id`,
    [id],
  );

  return {
    ...publicRequest(row),
    history: history.map((entry) => ({ ...entry, id: Number(entry.id) })),
  };
}

function canSeeRequest(user, request) {
  if (Number(request.raisedById) === user.id) return true;
  if (user.role === "manager") return true;
  return (
    user.role === "accounts" &&
    ["pending_accounts", "approved", "rejected"].includes(request.status)
  );
}

function parsePaise(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

function formatPaise(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const formatted = `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

function validateFields(body, allowedFields) {
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((key) => !allowedFields.includes(key))) {
    return "Provide one or more supported fields";
  }
  if (
    "category" in body &&
    (typeof body.category !== "string" ||
      !categories.includes(body.category.trim()))
  ) {
    return "category must be Materials, Labour, Transport, Equipment rental, or Other";
  }
  if (
    "description" in body &&
    (typeof body.description !== "string" ||
      body.description.trim().length < 10)
  ) {
    return "description must be at least 10 characters";
  }
  if ("amount" in body) {
    const amountPaise = parsePaise(body.amount);
    if (
      amountPaise === null ||
      amountPaise <= 0n ||
      amountPaise > maxAmountPaise
    ) {
      return "amount must be more than ₹0 and no more than ₹5,00,000, with at most 2 decimal places";
    }
  }
  return null;
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

router.get("/", async (request, response, next) => {
  try {
    const { user } = request;
    const requestedStatus = request.query.status;
    if (requestedStatus && !statuses.includes(requestedStatus)) {
      return response.status(400).json({ error: "Invalid status" });
    }

    const conditions = [];
    const values = [];
    values.push(user.id);
    conditions.push(`orders.raised_by_id = $${values.length}`);
    if (requestedStatus) {
      values.push(requestedStatus);
      conditions.push(`orders.status = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${requestSelect} ${where} ORDER BY orders.created_at DESC, orders.id DESC`,
      values,
    );
    response.json(rows.map(publicRequest));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (request, response, next) => {
  try {
    const { projectId, category, amount, description } = request.body || {};
    if (
      !Number.isSafeInteger(projectId) ||
      projectId <= 0 ||
      projectId > 2147483647
    ) {
      return response
        .status(400)
        .json({ error: "projectId must be a positive integer" });
    }
    const validationError = validateFields({ category, amount, description }, [
      "category",
      "amount",
      "description",
    ]);
    if (validationError)
      return response.status(400).json({ error: validationError });
    const amountPaise = parsePaise(amount);

    const result = await withTransaction(async (client) => {
      const project = await client.query(
        "SELECT id FROM projects WHERE id = $1",
        [projectId],
      );
      if (!project.rowCount) return { invalidProject: true };
      const inserted = await client.query(
        `INSERT INTO project_orders (project_id, raised_by_id, category, amount_inr, description, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_manager') RETURNING id`,
        [
          projectId,
          request.user.id,
          category.trim(),
          formatPaise(amountPaise),
          description.trim(),
        ],
      );
      const id = inserted.rows[0].id;
      await client.query(
        `INSERT INTO request_history (request_id, actor_id, action, to_status)
         VALUES ($1, $2, 'created', 'pending_manager')`,
        [id, request.user.id],
      );
      return { request: await getDetails(client, id) };
    });
    if (result.invalidProject)
      return response
        .status(400)
        .json({ error: "projectId does not identify an existing project" });
    response.status(201).json(result.request);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (request, response, next) => {
  try {
    const row = await getRequest(pool, request.params.id);
    if (!row) return response.status(404).json({ error: "Request not found" });
    if (!canSeeRequest(request.user, row))
      return response
        .status(403)
        .json({ error: "Not allowed to view this request" });
    response.json(await getDetails(pool, request.params.id));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (request, response, next) => {
  try {
    const body = request.body || {};
    const validationError = validateFields(body, [
      "category",
      "amount",
      "description",
    ]);
    if (validationError)
      return response.status(400).json({ error: validationError });

    const result = await withTransaction(async (client) => {
      const current = await client.query(
        "SELECT raised_by_id, status FROM project_orders WHERE id = $1 FOR UPDATE",
        [request.params.id],
      );
      if (!current.rowCount) return { notFound: true };
      const row = current.rows[0];
      if (Number(row.raised_by_id) !== request.user.id)
        return { forbidden: true };
      if (row.status !== "pending_manager") return { conflict: true };

      const columns = {
        category: "category",
        amount: "amount_inr",
        description: "description",
      };
      const updates = Object.keys(body);
      const values = updates.map((key) => {
        if (key === "amount") return formatPaise(parsePaise(body.amount));
        return typeof body[key] === "string" ? body[key].trim() : body[key];
      });
      const setClause = updates
        .map((key, index) => `${columns[key]} = $${index + 1}`)
        .join(", ");
      values.push(request.params.id);
      await client.query(
        `UPDATE project_orders SET ${setClause} WHERE id = $${values.length}`,
        values,
      );
      await client.query(
        `INSERT INTO request_history (request_id, actor_id, action, from_status, to_status)
         VALUES ($1, $2, 'updated', $3, $3)`,
        [request.params.id, request.user.id, row.status],
      );
      return { request: await getDetails(client, request.params.id) };
    });
    if (result.notFound)
      return response.status(404).json({ error: "Request not found" });
    if (result.forbidden)
      return response
        .status(403)
        .json({ error: "Only the requester may edit this request" });
    if (result.conflict)
      return response
        .status(409)
        .json({ error: "Only pending requests may be edited" });
    response.json(result.request);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/cancel", async (request, response, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const current = await client.query(
        "SELECT raised_by_id, status FROM project_orders WHERE id = $1 FOR UPDATE",
        [request.params.id],
      );
      if (!current.rowCount) return { notFound: true };
      const row = current.rows[0];
      if (Number(row.raised_by_id) !== request.user.id)
        return { forbidden: true };
      if (row.status !== "pending_manager") return { conflict: true };
      await client.query(
        "UPDATE project_orders SET status = 'cancelled' WHERE id = $1",
        [request.params.id],
      );
      await client.query(
        `INSERT INTO request_history (request_id, actor_id, action, from_status, to_status)
         VALUES ($1, $2, 'cancelled', $3, 'cancelled')`,
        [request.params.id, request.user.id, row.status],
      );
      return { request: await getDetails(client, request.params.id) };
    });
    if (result.notFound)
      return response.status(404).json({ error: "Request not found" });
    if (result.forbidden)
      return response
        .status(403)
        .json({ error: "Only the requester may cancel this request" });
    if (result.conflict)
      return response
        .status(409)
        .json({ error: "Only pending requests may be cancelled" });
    response.json(result.request);
  } catch (error) {
    next(error);
  }
});

async function decide(request, response, next, action) {
  try {
    const user = request.user;
    const requiredStatus =
      user.role === "manager"
        ? "pending_manager"
        : user.role === "accounts"
          ? "pending_accounts"
          : null;
    if (!requiredStatus)
      return response
        .status(403)
        .json({ error: "Your role cannot approve or reject requests" });
    if (
      action === "reject" &&
      (typeof request.body?.reason !== "string" ||
        request.body.reason.trim().length < 10)
    ) {
      return response
        .status(400)
        .json({ error: "A rejection reason must be at least 10 characters" });
    }

    const result = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT status, raised_by_id, project_id, amount_inr
         FROM project_orders WHERE id = $1 FOR UPDATE`,
        [request.params.id],
      );
      if (!current.rowCount) return { notFound: true };
      const row = current.rows[0];
      if (Number(row.raised_by_id) === user.id) return { forbidden: true };
      if (row.status !== requiredStatus) return { conflict: true };

      let companyFunded = "0.00";
      if (action === "approve") {
        const projectResult = await client.query(
          "SELECT budget_inr, funds_received_inr FROM projects WHERE id = $1 FOR UPDATE",
          [row.project_id],
        );
        if (!projectResult.rowCount) return { notFound: true };
        const totalsResult = await client.query(
          `SELECT
             COALESCE(SUM(amount_inr) FILTER (
               WHERE status IN ('approved', 'pending_accounts')
             ), 0)::text AS committed,
             COALESCE(SUM(amount_inr) FILTER (WHERE status = 'approved'), 0)::text AS approved
           FROM project_orders
           WHERE project_id = $1`,
          [row.project_id],
        );
        const project = projectResult.rows[0];
        const totals = totalsResult.rows[0];
        const requestPaise = parsePaise(String(row.amount_inr));
        const committedPaise = parsePaise(totals.committed);
        const budgetPaise = parsePaise(String(project.budget_inr));
        const addedPaise = row.status === "pending_manager" ? requestPaise : 0n;
        const remainingPaise = budgetPaise - committedPaise;
        if (committedPaise + addedPaise > budgetPaise) {
          return {
            budgetExceeded: true,
            remainingBudget: formatPaise(remainingPaise),
          };
        }

        const nextStatus =
          user.role === "manager" &&
          requestPaise > accountApprovalThresholdPaise
            ? "pending_accounts"
            : "approved";
        if (nextStatus === "approved") {
          const approvedBeforePaise = parsePaise(totals.approved);
          const fundsReceivedPaise = parsePaise(
            String(project.funds_received_inr),
          );
          const companyFundedPaise =
            requestPaise <
            approvedBeforePaise + requestPaise - fundsReceivedPaise
              ? requestPaise
              : approvedBeforePaise + requestPaise > fundsReceivedPaise
                ? approvedBeforePaise + requestPaise - fundsReceivedPaise
                : 0n;
          companyFunded = formatPaise(companyFundedPaise);
        }

        await client.query(
          `UPDATE project_orders
           SET status = $1, company_funded_inr = $2
           WHERE id = $3`,
          [nextStatus, companyFunded, request.params.id],
        );
        await client.query(
          `INSERT INTO request_history (request_id, actor_id, action, from_status, to_status, reason)
           VALUES ($1, $2, 'approve', $3, $4, NULL)`,
          [request.params.id, user.id, row.status, nextStatus],
        );
        return { request: await getDetails(client, request.params.id) };
      }

      const nextStatus = "rejected";
      await client.query(
        "UPDATE project_orders SET status = $1 WHERE id = $2",
        [nextStatus, request.params.id],
      );
      await client.query(
        `INSERT INTO request_history (request_id, actor_id, action, from_status, to_status, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          request.params.id,
          user.id,
          action,
          row.status,
          nextStatus,
          request.body.reason.trim(),
        ],
      );
      return { request: await getDetails(client, request.params.id) };
    });
    if (result.notFound)
      return response.status(404).json({ error: "Request not found" });
    if (result.forbidden)
      return response.status(403).json({
        error: "Requesters cannot approve or reject their own requests",
      });
    if (result.budgetExceeded)
      return response.status(409).json({
        error: `Insufficient project budget. Only ₹${result.remainingBudget} remains.`,
        remainingBudget: result.remainingBudget,
      });
    if (result.conflict)
      return response
        .status(409)
        .json({ error: "Request is not waiting for your approval" });
    response.json(result.request);
  } catch (error) {
    next(error);
  }
}

router.post("/:id/approve", (request, response, next) =>
  decide(request, response, next, "approve"),
);
router.post("/:id/reject", (request, response, next) =>
  decide(request, response, next, "reject"),
);

module.exports = router;
