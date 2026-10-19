exports.up = (pgm) => {
  pgm.createTable("project_orders", {
    id: "id",
    project_id: {
      type: "integer",
      notNull: true,
      references: '"projects"',
      onDelete: "RESTRICT",
    },
    raised_by_id: {
      type: "integer",
      notNull: true,
      references: '"people"',
      onDelete: "RESTRICT",
    },
    category: { type: "varchar(80)", notNull: true },
    amount_inr: { type: "bigint", notNull: true, check: "amount_inr >= 0" },
    description: { type: "text", notNull: true },
    status: {
      type: "varchar(32)",
      notNull: true,
      check: "status IN ('approved', 'pending_manager')",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("project_orders", "project_id");
  pgm.createIndex("project_orders", "raised_by_id");
};

exports.down = (pgm) => {
  pgm.dropTable("project_orders");
};
