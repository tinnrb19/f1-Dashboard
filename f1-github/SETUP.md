# ติดตั้งเว็บ F1 บน GitHub + ระบบหลังบ้าน (ทำครั้งเดียว ประมาณ 15 นาที ฟรีทั้งหมด)

หลังบ้านใช้ **Supabase** (ฐานข้อมูล + ระบบล็อกอิน) เพราะ GitHub Pages เป็นเว็บแบบไฟล์ล้วน ใส่ username/password ในโค้ดตรงๆ ไม่ได้ (ใครกด View Source ก็เห็น) ตัวอื่นๆ ของเว็บยังทำงานเหมือนเดิม

## 1) สร้างโปรเจกต์ Supabase
1. สมัครที่ supabase.com แล้วกด **New project** (เลือก Region ใกล้ไทย เช่น Singapore) รอสร้างเสร็จ
2. เมนู **SQL Editor** → วางเนื้อไฟล์ `supabase/setup.sql` ทั้งไฟล์ → กด **Run** (รันซ้ำได้ ข้อมูลไม่หาย)

## 2) สร้างบัญชีแอดมิน
1. **Authentication → Users → Add user → Create new user**
   ใส่ **อีเมล** + **รหัสผ่านยาวๆ (อย่างน้อย 10 ตัว)** แล้วติ๊ก **Auto Confirm User**
   อีเมลนี้คือ "username" ที่ใช้ล็อกอิน (Supabase ใช้อีเมลเป็นชื่อผู้ใช้ ตั้งเป็นคำสั้นๆ ไม่ได้)
2. **Authentication → Sign In / Providers** (บางเวอร์ชันชื่อ Settings) → ปิด **Allow new users to sign up** กันคนอื่นสมัครเอง
3. กลับไป **SQL Editor** รันบรรทัดนี้ (แก้อีเมลให้ตรง):
```sql
insert into public.admins (user_id)
select id from auth.users where email = 'อีเมลของคุณ@example.com'
on conflict do nothing;
```
ล็อกอินได้อย่างเดียวไม่พอ ต้องอยู่ในตาราง `admins` ถึงจะแก้ไขอะไรได้

## 3) ใส่ค่าเชื่อมต่อในไฟล์ `config.js`
**Project Settings → API Keys** คัดลอก **Project URL** และคีย์แบบ **anon / publishable** มาวางใน `config.js`
คีย์สองตัวนี้ "เปิดเผยได้" ความปลอดภัยมาจาก RLS ใน setup.sql ห้ามใส่ `service_role` หรือ secret key เด็ดขาด

## 4) ขึ้น GitHub Pages
1. สร้าง repo ชื่อ **`ชื่อผู้ใช้GitHub.github.io`** (ถ้าตั้งชื่ออื่นก็ได้ แต่แอป Android จะติดเรื่องตำแหน่งไฟล์ ดูข้อ 6)
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ **รวมไฟล์ `.nojekyll`** (ไฟล์นี้ทำให้โฟลเดอร์ที่ขึ้นต้นด้วยจุด เช่น `.well-known` ถูกเสิร์ฟ)
3. **Settings → Pages → Deploy from a branch → main / (root)** แล้วรอ 1-2 นาที

## 5) ใช้งาน
- เว็บ: `https://ชื่อผู้ใช้.github.io/`
- หลังบ้าน: `https://ชื่อผู้ใช้.github.io/admin.html`
แอดมินทำได้: ประกาศแบนเนอร์ · ชื่อเว็บ/สีหลัก/ทีมไฮไลต์ · ซ่อนแท็บ · ข่าว (ปักหมุดได้) · กรอกตาราง F2/F3 เอง · ดูสถิติเข้าชม (ไม่เก็บ IP) · ประวัติการทำงาน (audit log) · ดู/ดาวน์โหลดข้อมูลทั้งหมดเป็น JSON · เปลี่ยนรหัสผ่าน · ออกจากระบบอุปกรณ์อื่น

## 6) แอป Android (APK) — ต้องทำใหม่
APK เดิมผูกกับ `...netlify.app` ถ้าเลิกใช้ Netlify แอปจะเปิดไม่ได้
1. เข้า pwabuilder.com ใส่ URL ใหม่ของ GitHub แล้ว Generate Package ใหม่
2. นำ `assetlinks.json` ที่ได้ไปวางที่ `.well-known/assetlinks.json` **ที่รากของ `ชื่อผู้ใช้.github.io`** (TWA ตรวจที่ราก domain เท่านั้น repo ที่เป็น `/ชื่อrepo/` จะไม่ผ่าน)

## ความปลอดภัยที่ควรรู้
- ล็อกอินผิดซ้ำ Supabase จำกัดอัตราให้เอง · รหัสผ่านไม่ได้อยู่ในโค้ดเว็บ
- ใครก็อ่านข้อมูลสาธารณะ (ประกาศ/ข่าว/ตาราง F2-F3) ได้ แต่แก้ได้เฉพาะแอดมินที่อยู่ในตาราง `admins`
- ยอดเข้าชมนับจากสคริปต์ในหน้าเว็บ คนที่ปิด JavaScript จะไม่ถูกนับ และดู log ฝั่ง GitHub Pages ไม่ได้
- อย่า commit `service_role` / secret key / รหัสผ่านลง repo
