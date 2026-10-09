import { existsSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
if (existsSync(".env.local"))
  throw new Error(".env.local 已存在，为避免覆盖账号，已停止。");
const password = randomBytes(18).toString("base64url");
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
writeFileSync(
  ".env.local",
  `NEWS_DATA_DIR=./data\nNEWS_USERNAME=owner\nNEWS_PASSWORD_HASH=${salt}:${hash}\nNEWS_SECURE_COOKIE=false\n`,
  { mode: 0o600 },
);
writeFileSync(
  ".local-access.txt",
  `personal_news 本机登录\n用户名：owner\n密码：${password}\n\n此文件仅供本人查看，已从版本控制排除。部署时使用独立账号配置。\n`,
  { mode: 0o600 },
);
console.log("私人账号已配置。登录信息保存在 .local-access.txt，请妥善保管。");
