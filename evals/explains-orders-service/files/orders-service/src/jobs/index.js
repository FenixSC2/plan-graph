import { register } from "../queue.js";
import { sendConfirmation } from "./send-confirmation.js";

export function registerJobs() {
  register("order-confirmation", sendConfirmation);
}
