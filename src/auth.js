const jwt = require("jsonwebtoken");
const pool = require("./db");

async function authenticate(request, response, next) {
  const authorization = request.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({ error: "Bearer token required" });
  }

  if (!process.env.JWT_SECRET) {
    return response
      .status(503)
      .json({ error: "Authentication is not configured" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id, name, email, role FROM people WHERE id = $1",
      [payload.sub],
    );
    if (!rows[0])
      return response.status(401).json({ error: "User no longer exists" });
    request.user = { ...rows[0], id: Number(rows[0].id) };
    next();
  } catch (error) {
    if (
      error.name !== "JsonWebTokenError" &&
      error.name !== "TokenExpiredError" &&
      error.name !== "NotBeforeError"
    ) {
      return next(error);
    }
    response.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = authenticate;
