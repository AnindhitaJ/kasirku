// Edge Function: Owner membuat akun karyawan (nama + kata sandi).
// Deploy: supabase functions deploy create-employee
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: { user } } = await caller.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { name, password, store_ids } = await req.json()
  const { data: stores } = await admin.from('kk_stores').select('id, owner_id').in('id', store_ids)
  if (!stores?.length || stores.some((s) => s.owner_id !== user.id))
    return new Response('Forbidden', { status: 403 })

  // Login memakai nama; email teknis diturunkan dari nama (nama harus unik)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
  const { data, error } = await admin.auth.admin.createUser({
    email: `${slug}@kasirku.app`, password, email_confirm: true,
  })
  if (error) return new Response(error.message, { status: 400 })

  for (const sid of store_ids) {
    const { data: m } = await admin.from('kk_members')
      .insert({ store_id: sid, user_id: data.user.id, name }).select('id').single()
    await admin.from('kk_member_secrets').upsert({ member_id: m!.id, password_plain: password })
  }
  return Response.json({ ok: true })
})
