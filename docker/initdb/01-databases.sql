-- Development database is POSTGRES_DB. Create a separate database for integration tests.
CREATE DATABASE logorder_test OWNER logorder;
\connect logorder
CREATE EXTENSION IF NOT EXISTS timescaledb;
\connect logorder_test
CREATE EXTENSION IF NOT EXISTS timescaledb;
