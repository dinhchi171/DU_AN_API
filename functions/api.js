// File: functions/api.js

const GAS_URL = "https://script.google.com/macros/s/AKfycbytMz2q9x2qr6IpZhDUTBQMt6sTUxKOYGt0_x3B9ccumXiP3s5pvO6vgwp3C43Dizyr/exec"; 
const SALT = '8Gochom4Truyen6Yen28_TuyetpassMat_68247294\\74\\45!@^%!@#';
const CACHE_TTL_MS = 14400 * 1000; // 4 tiếng tính bằng mili-giây

// Chống Spam (Rate Limit) cho Cloudflare
const ipCache = new Map(); 
const RATE_LIMIT_MAX = 60; 
const RATE_LIMIT_WINDOW = 60 * 1000; 

export async function onRequest(context) {
    const { request, env, waitUntil } = context; // Thêm waitUntil để chạy ngầm
    const url = new URL(request.url);
    const method = request.method;
    const now = Date.now();

    // ----------------------------------------------------
    // 1. BỘ LỌC CỬA BẢO MẬT (CORS & ORIGIN CHECK)
    // ----------------------------------------------------
    const ALLOWED_ORIGINS = [
        "https://goctruyencuayen.blogspot.com",
        "https://khotruyenhaymienphi.blogspot.com",
        "http://localhost" 
    ];

    const requestOrigin = request.headers.get("Origin") || request.headers.get("Referer") || "";
    const isAllowed = ALLOWED_ORIGINS.some(domain => requestOrigin.includes(domain));

    if (!requestOrigin || !isAllowed) {
        return new Response(JSON.stringify({ error: "Truy cập bị từ chối!!!" }), { status: 403 });
    }

    const corsHeaders = {
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    };

    if (method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // ----------------------------------------------------
    // 2. CHỐNG SPAM (RATE LIMITING) BẰNG IP
    // ----------------------------------------------------
    const clientIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';
    if (clientIP !== 'unknown_ip') {
        const ipRecord = ipCache.get(clientIP);
        if (!ipRecord) {
            ipCache.set(clientIP, { count: 1, startTime: now });
        } else {
            if (now - ipRecord.startTime < RATE_LIMIT_WINDOW) {
                ipRecord.count++;
                if (ipRecord.count > RATE_LIMIT_MAX) {
                    return new Response(JSON.stringify({ error: "Truy cập quá nhanh. Vui lòng chờ 1 phút!" }), {
                        status: 429, headers: corsHeaders
                    });
                }
            } else {
                ipCache.set(clientIP, { count: 1, startTime: now });
            }
        }
    }

    try {
        // ----------------------------------------------------
        // 3. LUỒNG GET: LẤY GỢI Ý SHOPEE TỪ CLOUDFLARE KV (STALE-WHILE-REVALIDATE)
        // ----------------------------------------------------
        if (method === 'GET' && url.searchParams.has("index")) {
            const idx = url.searchParams.get("index");
            
            // Đọc từ KV kèm siêu dữ liệu (Metadata) để lấy nhãn thời gian
            const cachedObject = await env.TRUYEN_CACHE.getWithMetadata("ALL_HINTS", { type: "json" });
            let allHintsCache = null;

            if (cachedObject && cachedObject.value) {
                allHintsCache = cachedObject.value;
                const lastUpdated = cachedObject.metadata?.lastUpdated || 0;
                
                // NẾU CACHE QUÁ 4 TIẾNG -> TRẢ VỀ NGAY & GỌI NGẦM GAS ĐỂ CẬP NHẬT KV
                if (now - lastUpdated > CACHE_TTL_MS) {
                    waitUntil((async () => {
                        try {
                            const res = await fetch(`${GAS_URL}?action=get_all_hints&key=${env.API_SECRET_KEY}`);
                            const resData = await res.json();
                            if (resData.success && resData.data) {
                                // Lưu vĩnh viễn không dùng expirationTtl, chỉ quản lý qua lastUpdated
                                await env.TRUYEN_CACHE.put("ALL_HINTS", JSON.stringify(resData.data), {
                                    metadata: { lastUpdated: Date.now() }
                                });
                            }
                        } catch (e) { console.log("Lỗi cập nhật ngầm HINTS:", e); }
                    })());
                }
            } else {
                // TRƯỜNG HỢP XUI NHẤT (KV TRỐNG HOÀN TOÀN) -> BUỘC PHẢI CHỜ GAS
                const response = await fetch(`${GAS_URL}?action=get_all_hints&key=${env.API_SECRET_KEY}`);
                const resData = await response.json();
                if (resData.success && resData.data) {
                    allHintsCache = resData.data; 
                    await env.TRUYEN_CACHE.put("ALL_HINTS", JSON.stringify(allHintsCache), {
                        metadata: { lastUpdated: Date.now() }
                    });
                } else {
                    allHintsCache = {}; 
                }
            }

            const storyData = allHintsCache[idx];
            const responseData = storyData ? storyData : { found: false, error: "Truyện này không có mật khẩu từ link quảng cáo. Vui lòng sử dụng Pass Vip để đọc truyện! " + idx };

            return new Response(JSON.stringify(responseData), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
            });
        }

        // ----------------------------------------------------
        // 4. LUỒNG POST: XỬ LÝ VIP & ADMIN CLEAR CACHE
        // ----------------------------------------------------
        if (method === 'POST') {
            const body = await request.json();

            // A. PING TỪ GAS (CẬP NHẬT NGẦM TỨC THÌ)
            if (body.action === 'clearPassCache') {
                if (body.key !== env.API_SECRET_KEY) return new Response('Denied', { status: 403, headers: corsHeaders });
                
                // Thay vì xóa trắng, ra lệnh cho Cloudflare kéo dữ liệu mới ngay lập tức
                waitUntil((async () => {
                    try {
                        // Kéo Data HINTS
                        const resHints = await fetch(`${GAS_URL}?action=get_all_hints&key=${env.API_SECRET_KEY}`);
                        const hintsData = await resHints.json();
                        if (hintsData.success && hintsData.data) {
                            await env.TRUYEN_CACHE.put("ALL_HINTS", JSON.stringify(hintsData.data), {
                                metadata: { lastUpdated: Date.now() }
                            });
                        }
                        
                        // Kéo Data VIP
                        const resVip = await fetch(GAS_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'sync_vip_list', secret: env.API_SECRET_KEY })
                        });
                        const vipData = await resVip.json();
                        if (vipData.success && vipData.data) {
                            await env.TRUYEN_CACHE.put("VIP_HASHES", JSON.stringify(vipData.data), {
                                metadata: { lastUpdated: Date.now() }
                            });
                        }
                    } catch (e) { console.log("Lỗi xử lý Ping ngầm:", e); }
                })());
                
                return new Response(JSON.stringify({ success: true, message: "Đã nhận Ping, Cloudflare đang ngầm tải & cập nhật bản mới nhất!" }), {
                    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            // B. TÍNH NĂNG CHECK VIP (CŨNG ÁP DỤNG STALE-WHILE-REVALIDATE)
            if (body.action === 'check_vip') {
                const userPass = (body.password || '').toString().trim().toLowerCase();
                if (!userPass) return new Response(JSON.stringify({ isValid: false }), { status: 200, headers: corsHeaders });

                const cachedVip = await env.TRUYEN_CACHE.getWithMetadata("VIP_HASHES", { type: "json" });
                let vipHashesCache = null;

                if (cachedVip && cachedVip.value) {
                    vipHashesCache = cachedVip.value;
                    const lastUpdated = cachedVip.metadata?.lastUpdated || 0;

                    // Nếu quá 4 tiếng -> Cập nhật ngầm danh sách VIP
                    if (now - lastUpdated > CACHE_TTL_MS) {
                        waitUntil((async () => {
                            try {
                                const response = await fetch(GAS_URL, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'sync_vip_list', secret: env.API_SECRET_KEY })
                                });
                                const resData = await response.json();
                                if (resData.success && resData.data) {
                                    await env.TRUYEN_CACHE.put("VIP_HASHES", JSON.stringify(resData.data), {
                                        metadata: { lastUpdated: Date.now() }
                                    });
                                }
                            } catch (e) { console.log("Lỗi cập nhật ngầm VIP:", e); }
                        })());
                    }
                } else {
                    // KV trống -> Buộc phải lấy
                    const response = await fetch(GAS_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'sync_vip_list', secret: env.API_SECRET_KEY })
                    });
                    const resData = await response.json();
                    
                    if (resData.success && resData.data) {
                        vipHashesCache = resData.data; 
                        await env.TRUYEN_CACHE.put("VIP_HASHES", JSON.stringify(vipHashesCache), {
                            metadata: { lastUpdated: Date.now() }
                        });
                    } else {
                        return new Response(JSON.stringify({ isValid: false, error: "GAS Sync Failed" }), { status: 200, headers: corsHeaders });
                    }
                }

                // Mã hóa MD5 và đối chiếu
                const hashedInput = md5(userPass + SALT);
                const isValid = vipHashesCache.includes(hashedInput);

                return new Response(JSON.stringify({ isValid: isValid }), {
                    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }
        }

        return new Response('Bad Request', { status: 400, headers: corsHeaders });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
}

// ========================================================
// HÀM MÃ HÓA MD5 NỘI BỘ (GIỮ NGUYÊN)
// ========================================================
function md5(string) {
    function rotateLeft(lValue, iShiftBits) { return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits)); }
    function addUnsigned(lX,lY) {
        var lX4,lY4,lX8,lY8,lResult;
        lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000);
        lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
        if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
        if (lX4 | lY4) { if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); else return (lResult ^ 0x40000000 ^ lX8 ^ lY8); }
        return (lResult ^ lX8 ^ lY8);
    }
    function F(x,y,z) { return (x & y) | ((~x) & z); }
    function G(x,y,z) { return (x & z) | (y & (~z)); }
    function H(x,y,z) { return (x ^ y ^ z); }
    function I(x,y,z) { return (y ^ (x | (~z))); }
    function FF(a,b,c,d,x,s,ac) { a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function GG(a,b,c,d,x,s,ac) { a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function HH(a,b,c,d,x,s,ac) { a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function II(a,b,c,d,x,s,ac) { a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function convertToWordArray(string) {
        var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1=lMessageLength + 8;
        var lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64; var lNumberOfWords = (lNumberOfWords_temp2+1)*16;
        var lWordArray=Array(lNumberOfWords-1); var lBytePosition = 0; var lByteCount = 0;
        while ( lByteCount < lMessageLength ) {
            lWordCount = (lByteCount-(lByteCount % 4))/4; lBytePosition = (lByteCount % 4)*8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount)<<lBytePosition)); lByteCount++;
        }
        lWordCount = (lByteCount-(lByteCount % 4))/4; lBytePosition = (lByteCount % 4)*8;
        lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80<<lBytePosition);
        lWordArray[lNumberOfWords-2] = lMessageLength<<3; lWordArray[lNumberOfWords-1] = lMessageLength>>>29; return lWordArray;
    }
    function wordToHex(lValue) {
        var WordToHexValue="",WordToHexValue_temp="",lByte,lCount;
        for (lCount = 0;lCount<=3;lCount++) {
            lByte = (lValue>>>(lCount*8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16);
            WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
        } return WordToHexValue;
    }
    function utf8Encode(string) { string = string.replace(/\r\n/g,"\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }
    var x=Array(); var k,AA,BB,CC,DD,a,b,c,d; var S11=7, S12=12, S13=17, S14=22, S21=5, S22=9 , S23=14, S24=20, S31=4, S32=11, S33=16, S34=23, S41=6, S42=10, S43=15, S44=21;
    string = utf8Encode(string); x = convertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
    for (k=0;k<x.length;k+=16) {
        AA=a; BB=b; CC=c; DD=d;
        a=FF(a,b,c,d,x[k+0], S11,0xD76AA478); d=FF(d,a,b,c,x[k+1], S12,0xE8C7B756); c=FF(c,d,a,b,x[k+2], S13,0x242070DB); b=FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
        a=FF(a,b,c,d,x[k+4], S11,0xF57C0FAF); d=FF(d,a,b,c,x[k+5], S12,0x4787C62A); c=FF(c,d,a,b,x[k+6], S13,0xA8304613); b=FF(b,c,d,a,x[k+7], S14,0xFD469501);
        a=FF(a,b,c,d,x[k+8], S11,0x698098D8); d=FF(d,a,b,c,x[k+9], S12,0x8B44F7AF); c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1); b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
        a=FF(a,b,c,d,x[k+12],S11,0x6B901122); d=FF(d,a,b,c,x[k+13],S12,0xFD987193); c=FF(c,d,a,b,x[k+14],S13,0xA679438E); b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
        a=GG(a,b,c,d,x[k+1], S21,0xF61E2562); d=GG(d,a,b,c,x[k+6], S22,0xC040B340); c=GG(c,d,a,b,x[k+11],S23,0x265E5A51); b=GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
        a=GG(a,b,c,d,x[k+5], S21,0xD62F105D); d=GG(d,a,b,c,x[k+10],S22,0x2441453);  c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681); b=GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
        a=GG(a,b,c,d,x[k+9], S21,0x21E1CDE6); d=GG(d,a,b,c,x[k+14],S22,0xC33707D6); c=GG(c,d,a,b,x[k+3], S23,0xF4D50D87); b=GG(b,c,d,a,x[k+8], S24,0x455A14ED);
        a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905); d=GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8); c=GG(c,d,a,b,x[k+7], S23,0x676F02D9); b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
        a=HH(a,b,c,d,x[k+5], S31,0xFFFA3942); d=HH(d,a,b,c,x[k+8], S32,0x8771F681); c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122); b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
        a=HH(a,b,c,d,x[k+1], S31,0xA4BEEA44); d=HH(d,a,b,c,x[k+4], S32,0x4BDECFA9); c=HH(c,d,a,b,x[k+7], S33,0xF6BB4B60); b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
        a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6); d=HH(d,a,b,c,x[k+0], S32,0xEAA127FA); c=HH(c,d,a,b,x[k+3], S33,0xD4EF3085); b=HH(b,c,d,a,x[k+6], S34,0x4881D05);
        a=HH(a,b,c,d,x[k+9], S31,0xD9D4D039); d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5); c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8); b=HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
        a=II(a,b,c,d,x[k+0], S41,0xF4292244); d=II(d,a,b,c,x[k+7], S42,0x432AFF97); c=II(c,d,a,b,x[k+14],S43,0xAB9423A7); b=II(b,c,d,a,x[k+5], S44,0xFC93A039);
        a=II(a,b,c,d,x[k+12],S41,0x655B59C3); d=II(d,a,b,c,x[k+3], S42,0x8F0CCC92); c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D); b=II(b,c,d,a,x[k+1], S44,0x85845DD1);
        a=II(a,b,c,d,x[k+8], S41,0x6FA87E4F); d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0); c=II(c,d,a,b,x[k+6], S43,0xA3014314); b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
        a=II(a,b,c,d,x[k+4], S41,0xF7537E82); d=II(d,a,b,c,x[k+11],S42,0xBD3AF235); c=II(c,d,a,b,x[k+2], S43,0x2AD7D2BB); b=II(b,c,d,a,x[k+9], S44,0xEB86D391);
        a=addUnsigned(a,AA); b=addUnsigned(b,BB); c=addUnsigned(c,CC); d=addUnsigned(d,DD);
    }
    var temp = wordToHex(a)+wordToHex(b)+wordToHex(c)+wordToHex(d);
    return temp.toLowerCase();
}