import { Client } from 'pg';

/** Creates the test database on first run (CREATE DATABASE cannot run inside migrations). */
export default async function setup() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/erp_test');
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (!exists.rowCount) await client.query(`create database "${name.replace(/"/g, '')}"`);
  await client.end();
}
