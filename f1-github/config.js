// ค่าเชื่อมต่อระบบหลังบ้าน (Supabase) — ค่าสองตัวนี้ "เปิดเผยได้" ออกแบบมาให้อยู่ในหน้าเว็บสาธารณะ
// ความปลอดภัยมาจาก RLS ใน supabase-setup.sql ไม่ใช่การซ่อนค่าเหล่านี้
// ห้ามใส่ service_role / secret key ในไฟล์นี้เด็ดขาด
window.F1_CLOUD = {
  url: "https://YOUR-PROJECT-ID.supabase.co",
  key: "YOUR-ANON-OR-PUBLISHABLE-KEY"
};
