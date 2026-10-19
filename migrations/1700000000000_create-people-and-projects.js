exports.up = (pgm) => {
  pgm.createTable("people", {
    id: "id",
    name: { type: "varchar(120)", notNull: true },
    email: { type: "varchar(255)", notNull: true, unique: true },
    role: {
      type: "varchar(32)",
      notNull: true,
      check: "role IN ('employee', 'manager', 'accounts')",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createTable("projects", {
    id: "id",
    name: { type: "varchar(180)", notNull: true },
    budget_inr: { type: "bigint", notNull: true, check: "budget_inr >= 0" },
    funds_received_inr: {
      type: "bigint",
      notNull: true,
      default: 0,
      check: "funds_received_inr >= 0",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("projects");
  pgm.dropTable("people");
};
