import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoReviewGateStore, ensureIndexes } from "../src/mongoStore.js";
import { runStoreConformance } from "./storeConformance.js";

// The durable store against the SAME contract the in-memory reference passes.
//
// HONEST STATUS. This suite is skipped unless REVIEW_GATE_TEST_MONGO_URL names a replica set, and no
// replica set was available where the Mongo store was written. So at the time of writing the durable
// implementation is TYPECHECKED AND NOT EXECUTED, and the handoff says so rather than letting a green
// run of the in-memory suite imply otherwise.
//
// The point of sharing the suite is that this is recoverable without writing anything new: set the
// variable, run it, and the answer changes from unverified to verified — or the store fails and the
// disagreement between the two implementations is exactly what gets surfaced.
//
//   REVIEW_GATE_TEST_MONGO_URL="mongodb://localhost:27017/?replicaSet=rs0" npm test
//
// A standalone mongod will NOT do: every method here is a multi-document transaction.

const url = process.env.REVIEW_GATE_TEST_MONGO_URL;

if (!url) {
  test("mongo: conformance SKIPPED — no replica set configured", { skip: true }, () => {
    // Deliberately a skip rather than a silent absence: a suite that says nothing about the durable store
    // reads the same as one that passed.
  });
} else if (!/replicaSet=/.test(url)) {
  test("mongo: conformance SKIPPED — REVIEW_GATE_TEST_MONGO_URL is not a replica set", { skip: true },
    () => {});
} else {
  let counter = 0;
  runStoreConformance("mongo", async () => {
    const client = new MongoClient(url);
    await client.connect();
    // A fresh database per case, so one test cannot see another's writes — the in-memory factory gets
    // that for free by constructing a new object.
    const dbName = `review_gate_conformance_${process.pid}_${counter++}`;
    const store = new MongoReviewGateStore(client, dbName);
    await ensureIndexes(store.database);
    return {
      store,
      dispose: async () => {
        await client.db(dbName).dropDatabase();
        await client.close();
      },
    };
  });
}
