import dotenv from "dotenv";
import path from "path";

const envFile = process.env["ENV_FILE"] ?? path.resolve(process.cwd(), "../../.env.api");
dotenv.config({ path: envFile });
