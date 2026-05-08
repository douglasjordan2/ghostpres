import type postgres from "postgres";
import type { User, Post, Comment } from "./blog.ts";

type Sql = ReturnType<typeof postgres>;

const users: User[] = [
  { _id: 1, username: "ada", email: "ada@example.com", joined_at: "2024-01-04T00:00:00Z" },
  { _id: 2, username: "grace", email: "grace@example.com", joined_at: "2024-02-15T00:00:00Z" },
  { _id: 3, username: "linus", email: "linus@example.com", joined_at: "2024-03-22T00:00:00Z" },
  { _id: 4, username: "carmack", email: "carmack@example.com", joined_at: "2024-05-10T00:00:00Z" },
];

const posts: Post[] = [
  {
    _id: 1,
    author_id: 1,
    title: "Notes on the Analytical Engine",
    body: "Long-form thoughts about computation and what becomes possible when machines work over symbols. ".repeat(10),
    tags: ["computing", "history"],
    published_at: "2025-04-01T09:00:00Z",
    views: 1240,
  },
  {
    _id: 2,
    author_id: 1,
    title: "On loops and the imagination",
    body: "Short essay on the nature of iteration. ".repeat(5),
    tags: ["computing", "essay"],
    published_at: "2025-04-15T10:00:00Z",
    views: 320,
  },
  {
    _id: 3,
    author_id: 2,
    title: "Compiler design: bottom-up",
    body: "How we built the first compiler that worked, and why we almost gave up halfway. ".repeat(15),
    tags: ["compilers", "history"],
    published_at: "2025-04-08T12:00:00Z",
    views: 2110,
  },
  {
    _id: 4,
    author_id: 2,
    title: "COBOL was not a mistake",
    body: "Defending a much-maligned language. ".repeat(20),
    tags: ["languages", "essay"],
    published_at: "2025-04-22T14:00:00Z",
    views: 880,
  },
  {
    _id: 5,
    author_id: 3,
    title: "Just for fun: kernel notes",
    body: "Some weekend hacking on schedulers. ".repeat(8),
    tags: ["kernels", "essay"],
    published_at: "2025-04-05T18:00:00Z",
    views: 1500,
  },
  {
    _id: 6,
    author_id: 4,
    title: "Quake's BSP and what made it fast",
    body: "Details on the BSP tree, lightmaps, and z-buffering tricks. ".repeat(12),
    tags: ["graphics", "essay"],
    published_at: "2025-04-12T20:00:00Z",
    views: 4400,
  },
];

const comments: Comment[] = [
  {
    _id: 1,
    post_id: 1,
    author_id: 2,
    body: "This is wonderful, thank you.",
    created_at: "2025-04-01T11:00:00Z",
    reactions: [
      { user_id: 3, kind: "love" },
      { user_id: 4, kind: "like" },
    ],
  },
  {
    _id: 2,
    post_id: 1,
    author_id: 3,
    body: "Disagree on the third paragraph but enjoyed the rest.",
    created_at: "2025-04-01T13:00:00Z",
    reactions: [{ user_id: 2, kind: "fire" }],
  },
  {
    _id: 3,
    post_id: 3,
    author_id: 1,
    body: "Bottom-up made all the difference.",
    created_at: "2025-04-08T13:00:00Z",
    reactions: [
      { user_id: 4, kind: "like" },
      { user_id: 3, kind: "like" },
      { user_id: 4, kind: "love" },
    ],
  },
  {
    _id: 4,
    post_id: 6,
    author_id: 3,
    body: "BSP discussion is the best part.",
    created_at: "2025-04-12T22:00:00Z",
    reactions: [
      { user_id: 1, kind: "fire" },
      { user_id: 2, kind: "fire" },
    ],
  },
  {
    _id: 5,
    post_id: 6,
    author_id: 1,
    body: "Worth a re-read.",
    created_at: "2025-04-13T08:00:00Z",
    reactions: [],
  },
];

export async function seedBlog(sql: Sql): Promise<void> {
  await sql`drop table if exists comments cascade`;
  await sql`drop table if exists posts cascade`;
  await sql`drop table if exists users cascade`;

  await sql`create table users    (id bigserial primary key, data jsonb not null)`;
  await sql`create table posts    (id bigserial primary key, data jsonb not null)`;
  await sql`create table comments (id bigserial primary key, data jsonb not null)`;

  for (const u of users) await sql`insert into users (data) values (${sql.json(u)})`;
  for (const p of posts) await sql`insert into posts (data) values (${sql.json(p)})`;
  for (const c of comments) await sql`insert into comments (data) values (${sql.json(c)})`;
}

export const sampleData = { users, posts, comments };
