// File: functions/_middleware.js
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 1. Cho phép /api đi qua để api.js tự xử lý
  if (url.pathname.startsWith("/api")) {
    return next();
  }

  // 2. Khóa chặt toàn bộ file .html (trừ trang chủ index.html)
  if (url.pathname.endsWith(".html") && url.pathname !== "/index.html") {
    const origin = request.headers.get("Origin") || "";
    const referer = request.headers.get("Referer") || "";
    const secFetchDest = request.headers.get("Sec-Fetch-Dest") || "";

    const ALLOWED = [
      "https://goctruyencuayen.blogspot.com",
      "https://khotruyenhaymienphi.blogspot.com",
      "http://localhost"
    ];

    const isFromBlog = ALLOWED.some(d => origin.startsWith(d) || referer.startsWith(d));

    // Chặn tuyệt đối nếu mở trực tiếp tab mới (document) hoặc dùng tool tải (không có Origin/Referer từ Blogspot)
    if (!isFromBlog || secFetchDest === "document") {
      return new Response("Truy cập bị từ chối!", { status: 403 });
    }
  }

  return next();
}