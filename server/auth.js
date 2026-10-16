const {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} = require("node:crypto");
const { id, fail, text, utc } = require("./domain");
const digest = (v) => createHash("sha256").update(v).digest("hex");
function passwordHash(password) {
  text(password, "Senha", 200);
  if (password.length < 12) fail("A senha deve ter no mínimo 12 caracteres.");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
function verify(password, stored) {
  try {
    const [salt, hash] = stored.split(":");
    return timingSafeEqual(
      Buffer.from(hash, "hex"),
      scryptSync(password, salt, 64),
    );
  } catch {
    return false;
  }
}
function installAuth(app, db, { origins, now = Date.now } = {}) {
  const allowed = new Set(
    origins || [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ],
  );
  const buckets = new Map();
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin))
      return res
        .status(403)
        .json({ error: "Origem não autorizada.", code: "ORIGIN" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,X-CSRF-Token,Idempotency-Key,x-api-key",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE");
      return res.sendStatus(204);
    }
    const key =
      req.ip + ":" + (req.path === "/v1/auth/login" ? "login" : "api");
    const limit = key.endsWith(":login") ? 10 : 600;
    const b = buckets.get(key) || { since: now(), count: 0 };
    if (now() - b.since > 60000) {
      b.since = now();
      b.count = 0;
    }
    b.count++;
    buckets.set(key, b);
    if (buckets.size > 10000)
      for (const [k, v] of buckets)
        if (now() - v.since > 60000) buckets.delete(k);
    if (b.count > limit)
      return res.status(429).json({
        error: "Muitas requisições. Aguarde um minuto.",
        code: "RATE_LIMIT",
      });
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("wappgr_session="));
    const token = cookie?.slice("wappgr_session=".length);
    req.auth = token
      ? db
          .prepare(
            "SELECT s.*,u.username FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?",
          )
          .get(digest(token), utc(now()))
      : null;
    next();
  });
  app.get("/api/v1/auth/session", (req, res) =>
    res.json({
      authenticated: !!req.auth,
      username: req.auth?.username,
      csrf: req.auth?.csrf,
      needsSetup: !db.prepare("SELECT id FROM admin_users LIMIT 1").get(),
    }),
  );
  app.post("/api/v1/auth/login", (req, res) => {
    const username = text(req.body.username, "Usuário", 100);
    text(req.body.password, "Senha", 200);
    const password = req.body.password;
    const user = db
      .prepare("SELECT * FROM admin_users WHERE username=?")
      .get(username);
    if (!user || !verify(password, user.password_hash))
      fail("Usuário ou senha inválidos.", 401, "AUTH");
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM admin_sessions WHERE expires_at<=?").run(
      utc(now()),
    );
    db.prepare("INSERT INTO admin_sessions VALUES(?,?,?,?)").run(
      digest(token),
      user.id,
      csrf,
      utc(now() + 12 * 3600000),
    );
    res.cookie("wappgr_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      maxAge: 12 * 3600000,
      path: "/",
    });
    res.json({ authenticated: true, username, csrf });
  });
  app.use("/api", (req, res, next) => {
    if (req.path === "/v1/crm/webhook/lead") return next();
    if (!req.auth)
      return res
        .status(401)
        .json({ error: "Faça login para continuar.", code: "AUTH" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== req.auth.csrf
    )
      return res.status(403).json({
        error: "Token de sessão inválido. Atualize a página.",
        code: "CSRF",
      });
    next();
  });
  app.post("/api/v1/auth/logout", (req, res) => {
    db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(
      req.auth.token_hash,
    );
    res.clearCookie("wappgr_session", { path: "/" });
    res.json({ success: true });
  });
}
function createAdmin(db, username, password) {
  username = text(username, "Usuário", 100);
  const existing = db
    .prepare("SELECT id FROM admin_users WHERE username=?")
    .get(username);
  const hash = passwordHash(password);
  db.transaction(() => {
    if (existing) {
      db.prepare("UPDATE admin_users SET password_hash=? WHERE id=?").run(
        hash,
        existing.id,
      );
      db.prepare("DELETE FROM admin_sessions WHERE user_id=?").run(existing.id);
    } else
      db.prepare("INSERT INTO admin_users VALUES(?,?,?)").run(
        id(),
        username,
        hash,
      );
  })();
}
module.exports = { installAuth, createAdmin, passwordHash };
