const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");
const authenticate = require("./auth");
const requestRoutes = require("./requestRoutes");

const app = express();

app.use(express.json());

app.get("/health", async (request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const { email, password } = request.body || {};
    if (typeof email !== "string" || typeof password !== "string") {
      return response
        .status(400)
        .json({ error: "email and password are required" });
    }
    if (!process.env.JWT_SECRET) {
      return response
        .status(503)
        .json({ error: "Authentication is not configured" });
    }
    const { rows } = await pool.query(
      "SELECT id, name, email, role, password_hash FROM people WHERE email = $1",
      [email.trim().toLowerCase()],
    );
    const person = rows[0];
    if (
      !person?.password_hash ||
      !(await bcrypt.compare(password, person.password_hash))
    ) {
      return response.status(401).json({ error: "Invalid email or password" });
    }
    const user = {
      id: Number(person.id),
      name: person.name,
      email: person.email,
      role: person.role,
    };
    const token = jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET, {
      expiresIn: "8h",
    });
    response.json({ token, user });
  } catch (error) {
    next(error);
  }
});

app.use("/api", authenticate);

app.get("/api/people", async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, role FROM people ORDER BY id",
    );
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects", async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT projects.id, projects.name,
              projects.budget_inr::text AS budget,
              projects.funds_received_inr::text AS "fundsReceived",
              COALESCE(SUM(orders.amount_inr) FILTER (
                WHERE orders.status IN ('pending_accounts', 'approved')
              ), 0)::text AS committed,
              COALESCE(SUM(orders.amount_inr) FILTER (
                WHERE orders.status = 'approved'
              ), 0)::text AS approved,
              (projects.budget_inr - COALESCE(SUM(orders.amount_inr) FILTER (
                WHERE orders.status IN ('pending_accounts', 'approved')
              ), 0))::text AS remaining,
              COALESCE(SUM(orders.company_funded_inr) FILTER (
                WHERE orders.status = 'approved'
              ), 0)::text AS "companyFunded"
       FROM projects
       LEFT JOIN project_orders AS orders ON orders.project_id = projects.id
       GROUP BY projects.id
       ORDER BY projects.id`,
    );
    response.json(
      rows.map((project) => {
        return {
          id: Number(project.id),
          name: project.name,
          budget: project.budget,
          fundsReceived: project.fundsReceived,
          committed: project.committed,
          approved: project.approved,
          remaining: project.remaining,
          companyFunded: project.companyFunded,
        };
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT orders.id, orders.project_id AS "projectId",
              people.name AS "raisedBy", orders.category,
              orders.amount_inr AS "amountInr", orders.description, orders.status
       FROM project_orders AS orders
       JOIN people ON people.id = orders.raised_by_id
       ORDER BY orders.id`,
    );
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/approvals", async (request, response, next) => {
  try {
    const status =
      request.user.role === "manager"
        ? "pending_manager"
        : request.user.role === "accounts"
          ? "pending_accounts"
          : null;
    if (!status) {
      return response.status(403).json({
        error: "Approvals are only available to managers and accounts",
      });
    }
    const { rows } = await pool.query(
      `SELECT orders.id, orders.project_id AS "projectId", projects.name AS "projectName",
              people.name AS "raisedBy", orders.category,
              orders.amount_inr::text AS amount, orders.description, orders.status,
              orders.created_at AS "createdAt",
              (projects.budget_inr - totals.committed - CASE
                WHEN orders.status = 'pending_manager' THEN orders.amount_inr
                ELSE 0
              END)::text AS "remainingAfterApproval",
              LEAST(orders.amount_inr, GREATEST(
                0::numeric,
                totals.approved + orders.amount_inr - projects.funds_received_inr
              ))::text AS "companyFundedIfApproved"
       FROM project_orders AS orders
       JOIN projects ON projects.id = orders.project_id
       JOIN people ON people.id = orders.raised_by_id
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(amount_inr) FILTER (
                  WHERE status IN ('approved', 'pending_accounts')
                ), 0) AS committed,
                COALESCE(SUM(amount_inr) FILTER (WHERE status = 'approved'), 0) AS approved
         FROM project_orders
         WHERE project_id = orders.project_id
       ) AS totals
        WHERE orders.status = $1 AND orders.raised_by_id <> $2
        ORDER BY orders.created_at, orders.id`,
      [status, request.user.id],
    );
    response.json(
      rows.map((row) => ({
        ...row,
        id: Number(row.id),
        projectId: Number(row.projectId),
        amount: row.amount,
      })),
    );
  } catch (error) {
    next(error);
  }
});

app.use("/api/requests", requestRoutes);

app.use((request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error, request, response, next) => {
  console.error(error);
  if (error.type === "entity.parse.failed") {
    return response
      .status(400)
      .json({ error: "Request body must contain valid JSON" });
  }
  response.status(500).json({ error: "Internal server error" });
});

module.exports = app;
