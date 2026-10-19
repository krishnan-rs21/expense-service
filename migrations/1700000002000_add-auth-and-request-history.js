exports.up = (pgm) => {
  pgm.addColumn("people", {
    password_hash: { type: "varchar(255)" },
  });

  pgm.sql(`
    ALTER TABLE project_orders
    DROP CONSTRAINT IF EXISTS project_orders_status_check;

    ALTER TABLE project_orders
    ADD CONSTRAINT project_orders_status_check
    CHECK (status IN ('pending_manager', 'pending_accounts', 'approved', 'rejected', 'cancelled'));
  `);

  pgm.createTable("request_history", {
    id: "id",
    request_id: {
      type: "integer",
      notNull: true,
      references: '"project_orders"',
      onDelete: "CASCADE",
    },
    actor_id: {
      type: "integer",
      notNull: true,
      references: '"people"',
      onDelete: "RESTRICT",
    },
    action: { type: "varchar(32)", notNull: true },
    from_status: { type: "varchar(32)" },
    to_status: { type: "varchar(32)" },
    reason: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("request_history", "request_id");
  pgm.createIndex("request_history", "request_id", {
    unique: true,
    where: "action = 'seeded'",
    name: "request_history_seed_key",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("request_history");
  pgm.dropColumn("people", "password_hash");
  pgm.sql(`
    ALTER TABLE project_orders
    DROP CONSTRAINT IF EXISTS project_orders_status_check;

    ALTER TABLE project_orders
    ADD CONSTRAINT project_orders_status_check
    CHECK (status IN ('approved', 'pending_manager'));
  `);
};
