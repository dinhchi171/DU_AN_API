// File: functions/_middleware.js
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. Cho phép /api và trang chủ đi qua
  if (path.startsWith("/api") || path === "/" || path === "/index.html") {
    return next();
  }

  // 2. Chặn tất cả các đường dẫn còn lại (bao gồm cả /realtime/Test không có đuôi .html)
  const origin = request.headers.get("Origin") || "";
  const referer = request.headers.get("Referer") || "";
  const secFetchDest = request.headers.get("Sec-Fetch-Dest") || "";

  const ALLOWED = [
    "https://goctruyencuayen.blogspot.com",
    "https://khotruyenhaymienphi.blogspot.com",
    "http://localhost"
  ];

  const isFromBlog = ALLOWED.some(d => origin.startsWith(d) || referer.startsWith(d));

  if (!isFromBlog || secFetchDest === "document") {
    return new Response("Truy cập bị từ chối!", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  return next();
}