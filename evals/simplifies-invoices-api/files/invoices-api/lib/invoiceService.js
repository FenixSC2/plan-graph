// Service layer between the handlers and the repository.
import * as repo from "./repo.js";

export function getAll() {
  return repo.all();
}

export function getById(id) {
  return repo.byId(id);
}

export function add(inv) {
  return repo.insert(inv);
}

export function update(id, patch) {
  return repo.update(id, patch);
}
