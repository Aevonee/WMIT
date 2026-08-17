'use strict';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function orderedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

class AttendanceIdentityMap {
  constructor(people) {
    this.people = clone(people || []);
    this.index = new Map();
    this.people.forEach((person) => {
      const names = [person.display_name, person.attendance_name].concat(person.name_aliases || []);
      names.filter(Boolean).forEach((name) => {
        const key = normalizedName(name);
        const matches = this.index.get(key) || [];
        matches.push(person);
        this.index.set(key, matches);
      });
    });
  }

  list() {
    return clone(this.people);
  }

  resolve(rawName) {
    const key = normalizedName(rawName);
    const matches = (this.index.get(key) || []).filter((person, index, all) => all.findIndex((candidate) => candidate.person_id === person.person_id) === index);
    if (!matches.length) return { status: 'UNKNOWN', raw_name: rawName || '', normalized_name: key };
    if (matches.length > 1) return { status: 'AMBIGUOUS', raw_name: rawName || '', normalized_name: key, candidates: clone(matches) };
    const person = matches[0];
    const canonical = person.display_name || person.attendance_name;
    return {
      status: 'MATCHED',
      person_id: person.person_id,
      person: clone(person),
      raw_name: rawName || '',
      normalized_name: key,
      match_type: orderedName(canonical) === orderedName(rawName) ? 'EXACT' : 'ALIAS',
      canonical_name: canonical
    };
  }
}

module.exports = { AttendanceIdentityMap, normalizedName, orderedName };
