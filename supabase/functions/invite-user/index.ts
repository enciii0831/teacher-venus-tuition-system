import { withSupabase } from "npm:@supabase/server";

const CO_OWNER_EMAIL = "kxnrnlxm@gmail.com";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || "");
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "Co-owner").trim();
    const callerId = ctx.userClaims?.sub || ctx.userClaims?.id;
    if (!workspaceId || email !== CO_OWNER_EMAIL) {
      return Response.json({ error: "Only the configured Co-owner email can be invited." }, { status: 400 });
    }

    const { data: membership, error: membershipError } = await ctx.supabase
      .from("workspace_members")
      .select("role,status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", callerId)
      .single();
    if (membershipError || membership?.role !== "owner" || membership?.status !== "active") {
      return Response.json({ error: "Only the original Owner can invite the Co-owner." }, { status: 403 });
    }

    const { error: inviteRowError } = await ctx.supabaseAdmin.from("workspace_invites").upsert({
      workspace_id: workspaceId,
      email,
      full_name: fullName,
      role: "co_owner",
      status: "pending",
      invited_by: callerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,email" });
    if (inviteRowError) return Response.json({ error: inviteRowError.message }, { status: 400 });

    const appUrl = Deno.env.get("APP_URL");
    const options = { data: { full_name: fullName }, ...(appUrl ? { redirectTo: appUrl } : {}) };
    const { data, error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, options);
    if (error) {
      const { data: users } = await ctx.supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = users?.users?.find((user) => user.email?.toLowerCase() === email);
      if (!existing) return Response.json({ error: error.message }, { status: 400 });
      await ctx.supabaseAdmin.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: existing.id, role: "co_owner", status: "active", updated_at: new Date().toISOString() }, { onConflict: "workspace_id,user_id" });
      await ctx.supabaseAdmin.from("workspace_invites").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("email", email);
    }
    await ctx.supabaseAdmin.from("audit_logs").insert({ workspace_id: workspaceId, user_id: callerId, user_email: ctx.userClaims?.email || "", user_role: "owner", action: "Invited Co-owner", record_label: email });
    return Response.json({ ok: true, user: data?.user || null });
  }),
};
