'use strict';

class Repository {
  insert() {
    throw new Error('Repository.insert must be implemented by an adapter.');
  }

  get() {
    throw new Error('Repository.get must be implemented by an adapter.');
  }

  update() {
    throw new Error('Repository.update must be implemented by an adapter.');
  }

  exists() {
    throw new Error('Repository.exists must be implemented by an adapter.');
  }
}

module.exports = { Repository };
