/* global Mongo, quit */
try {
  const connection = new Mongo("mongodb://mongo:27017/?directConnection=true");
  const hello = connection.getDB("admin").runCommand({ hello: 1 });
  if (hello.ok !== 1 || hello.setName !== "opsworkbench-staging-rs" || hello.isWritablePrimary !== true) quit(1);
  const ping = connection.getDB("admin").runCommand({ ping: 1 });
  quit(ping.ok === 1 ? 0 : 1);
} catch {
  quit(1);
}
