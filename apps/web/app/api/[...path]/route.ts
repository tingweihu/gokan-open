import type { NextRequest } from "next/server";
const upstream = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const headers = new Headers();
  for (const name of ["cookie", "content-type", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(
    `${upstream}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
    {
      method: request.method,
      headers,
      cache: "no-store",
      redirect: "manual",
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
    },
  );
  const result = new Headers({ "Cache-Control": "no-store" });
  for (const name of [
    "content-type",
    "set-cookie",
    "content-disposition",
    "x-request-id",
  ]) {
    const value = response.headers.get(name);
    if (value) result.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers: result,
  });
}
export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
