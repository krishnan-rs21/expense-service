const bcrypt = require("bcryptjs");
const pool = require("./db");
const SEED_PASSWORD = "Test@123";

const people = [
  ["Anu Thomas", "anu@test.local", "employee"],
  ["Rahul Nair", "rahul@test.local", "employee"],
  ["Meera Pillai", "meera@test.local", "manager"],
  ["Faisal Khan", "faisal@test.local", "manager"],
  ["Divya Menon", "divya@test.local", "accounts"],
];

const projects = [
  [1, "Office Fit-out, Technopark", 200000, 150000],
  [2, "Apartment Repainting, Kowdiar", 300000, 200000],
  [3, "Plumbing Overhaul, Pattom", 50000, 0],
];

const orders = [
  [
    1,
    1,
    "anu@test.local",
    "Materials",
    90000,
    "Cement and tiles for flooring",
    "approved",
  ],
  [
    2,
    1,
    "rahul@test.local",
    "Labour",
    50000,
    "Carpentry crew for partitions",
    "approved",
  ],
  [
    3,
    2,
    "anu@test.local",
    "Materials",
    40000,
    "Primer and emulsion paint",
    "approved",
  ],
  [
    4,
    1,
    "rahul@test.local",
    "Transport",
    8000,
    "Taxi for site visits, two weeks",
    "pending_manager",
  ],
  [
    5,
    2,
    "meera@test.local",
    "Equipment rental",
    12000,
    "Paint sprayer hire for a week",
    "pending_manager",
  ],
];

async function seed() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const [name, email, role] of people) {
      await client.query(
        `INSERT INTO people (name, email, role, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           password_hash = EXCLUDED.password_hash`,
        [name, email, role, passwordHash],
      );
    }

    for (const [id, name, budgetInr, fundsReceivedInr] of projects) {
      await client.query(
        `INSERT INTO projects (id, name, budget_inr, funds_received_inr)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           budget_inr = EXCLUDED.budget_inr,
           funds_received_inr = EXCLUDED.funds_received_inr`,
        [id, name, budgetInr, fundsReceivedInr],
      );
    }

    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('projects', 'id'),
         COALESCE((SELECT MAX(id) FROM projects), 1),
         EXISTS (SELECT 1 FROM projects)
       )`,
    );

    for (const [
      id,
      projectId,
      raisedByEmail,
      category,
      amountInr,
      description,
      status,
    ] of orders) {
      await client.query(
        `INSERT INTO project_orders
           (id, project_id, raised_by_id, category, amount_inr, description, status)
         SELECT $1, $2, people.id, $4, $5, $6, $7
         FROM people
         WHERE people.email = $3
         ON CONFLICT (id) DO UPDATE SET
           project_id = EXCLUDED.project_id,
           raised_by_id = EXCLUDED.raised_by_id,
           category = EXCLUDED.category,
           amount_inr = EXCLUDED.amount_inr,
           description = EXCLUDED.description,
           status = EXCLUDED.status`,
        [
          id,
          projectId,
          raisedByEmail,
          category,
          amountInr,
          description,
          status,
        ],
      );
      await client.query(
        `INSERT INTO request_history (request_id, actor_id, action, to_status)
         SELECT id, raised_by_id, 'seeded', status
         FROM project_orders
         WHERE id = $1
         ON CONFLICT (request_id) WHERE action = 'seeded' DO NOTHING`,
        [id],
      );
    }

    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('project_orders', 'id'),
         COALESCE((SELECT MAX(id) FROM project_orders), 1),
         EXISTS (SELECT 1 FROM project_orders)
       )`,
    );

    await client.query("COMMIT");
    console.log("Seed data inserted successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error("Failed to seed database:", error);
  process.exitCode = 1;
});
