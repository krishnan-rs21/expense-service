exports.up = (pgm) => {
  pgm.alterColumn("projects", "budget_inr", {
    type: "numeric(14,2)",
    using: "budget_inr::numeric(14,2)",
  });
  pgm.alterColumn("projects", "funds_received_inr", {
    type: "numeric(14,2)",
    using: "funds_received_inr::numeric(14,2)",
  });
  pgm.alterColumn("project_orders", "amount_inr", {
    type: "numeric(14,2)",
    using: "amount_inr::numeric(14,2)",
  });
  pgm.addColumn("project_orders", {
    company_funded_inr: {
      type: "numeric(14,2)",
      notNull: true,
      default: 0,
    },
  });

  pgm.sql(`
    WITH approved_before AS (
      SELECT id,
             COALESCE(
               SUM(amount_inr) OVER (
                 PARTITION BY project_id
                 ORDER BY created_at, id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ),
               0
             ) AS amount_before
      FROM project_orders
      WHERE status = 'approved'
    )
    UPDATE project_orders AS orders
    SET company_funded_inr = LEAST(
      orders.amount_inr,
      GREATEST(
        0::numeric,
        approved_before.amount_before + orders.amount_inr - projects.funds_received_inr
      )
    )
    FROM approved_before, projects
    WHERE orders.id = approved_before.id
      AND projects.id = orders.project_id;
  `);

  pgm.addConstraint("project_orders", "project_orders_amount_business_check", {
    check: "amount_inr > 0 AND amount_inr <= 500000",
  });
  pgm.addConstraint(
    "project_orders",
    "project_orders_category_business_check",
    {
      check:
        "category IN ('Materials', 'Labour', 'Transport', 'Equipment rental', 'Other')",
    },
  );
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM project_orders
        WHERE amount_inr <> trunc(amount_inr)
           OR company_funded_inr <> trunc(company_funded_inr)
        UNION ALL
        SELECT 1 FROM projects
        WHERE budget_inr <> trunc(budget_inr)
           OR funds_received_inr <> trunc(funds_received_inr)
      ) THEN
        RAISE EXCEPTION 'Cannot revert exact-paisa amounts to whole rupees';
      END IF;
    END $$;
  `);

  pgm.dropConstraint(
    "project_orders",
    "project_orders_category_business_check",
  );
  pgm.dropConstraint("project_orders", "project_orders_amount_business_check");
  pgm.dropColumn("project_orders", "company_funded_inr");
  pgm.alterColumn("project_orders", "amount_inr", {
    type: "bigint",
    using: "amount_inr::bigint",
  });
  pgm.alterColumn("projects", "funds_received_inr", {
    type: "bigint",
    using: "funds_received_inr::bigint",
  });
  pgm.alterColumn("projects", "budget_inr", {
    type: "bigint",
    using: "budget_inr::bigint",
  });
};
