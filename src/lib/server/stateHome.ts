import "server-only";
import os from "os";

// Where this machine's local-only state lives — this business's Firebase
// service account, the LAN device/business id, manually-added peers. Always
// the real user's home directory in production; ATTENDMS_HOME exists purely
// so two server instances in the same test run (simulating two separate
// kiosks) don't collide on one real home directory — never set in a real
// deployment.
export function getStateHome(): string {
  return process.env.ATTENDMS_HOME || os.homedir();
}
