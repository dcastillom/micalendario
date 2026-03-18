import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PlannerRole = "admin" | "editor" | "viewer";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getEnvValue(name: string) {
  const value = Deno.env.get(name)?.trim() ?? "";

  if (!value) {
    throw new Error(`Falta la variable ${name}.`);
  }

  return value;
}

function getBearerToken(headerValue: string | null) {
  const match = headerValue?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRole(value: unknown): PlannerRole | null {
  if (value === "admin" || value === "editor" || value === "viewer") {
    return value;
  }

  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  try {
    const supabaseUrl = getEnvValue("SUPABASE_URL");
    const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
    const bearerToken = getBearerToken(request.headers.get("Authorization"));

    if (!bearerToken) {
      return jsonResponse({ error: "No se recibió el token del usuario." }, 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user: callerUser },
      error: callerError,
    } = await serviceClient.auth.getUser(bearerToken);

    if (callerError || !callerUser) {
      return jsonResponse({ error: "No se pudo validar el usuario actual." }, 401);
    }

    const { data: callerProfile, error: callerProfileError } = await serviceClient
      .from("planner_users")
      .select("role, is_active")
      .eq("id", callerUser.id)
      .maybeSingle();

    if (callerProfileError) {
      return jsonResponse(
        { error: "No se pudo comprobar el rol del usuario actual." },
        500,
      );
    }

    if (!callerProfile?.is_active || callerProfile.role !== "admin") {
      return jsonResponse({ error: "Solo un admin puede gestionar usuarios." }, 403);
    }

    const body = await request.json();
    const action = String(body?.action ?? "").trim();

    if (action === "create") {
      const email = normalizeEmail(body?.email);
      const password = String(body?.password ?? "").trim();
      const role = normalizeRole(body?.role);

      if (!email || !password || !role) {
        return jsonResponse(
          { error: "Debes enviar email, contraseña y rol válidos." },
          400,
        );
      }

      if (password.length < 8) {
        return jsonResponse(
          { error: "La contraseña inicial debe tener al menos 8 caracteres." },
          400,
        );
      }

      const { data, error } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (error || !data.user) {
        return jsonResponse(
          { error: error?.message ?? "No se pudo crear el usuario." },
          400,
        );
      }

      const { error: profileError } = await serviceClient
        .from("planner_users")
        .upsert(
          {
            id: data.user.id,
            email,
            role,
            is_active: true,
            created_by: callerUser.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );

      if (profileError) {
        await serviceClient.auth.admin.deleteUser(data.user.id);
        return jsonResponse(
          { error: "No se pudo guardar el rol del nuevo usuario." },
          500,
        );
      }

      return jsonResponse({
        user: {
          id: data.user.id,
          email,
          role,
          isActive: true,
        },
      });
    }

    if (action === "delete") {
      const userId = String(body?.userId ?? "").trim();

      if (!userId) {
        return jsonResponse({ error: "Falta el identificador del usuario." }, 400);
      }

      if (userId === callerUser.id) {
        return jsonResponse(
          { error: "No puedes darte de baja a ti mismo desde este panel." },
          400,
        );
      }

      const { error } = await serviceClient.auth.admin.deleteUser(userId);

      if (error) {
        return jsonResponse(
          { error: error.message ?? "No se pudo dar de baja al usuario." },
          400,
        );
      }

      return jsonResponse({ success: true });
    }

    if (action === "set-active") {
      const userId = String(body?.userId ?? "").trim();
      const isActive = Boolean(body?.isActive);

      if (!userId) {
        return jsonResponse({ error: "Falta el identificador del usuario." }, 400);
      }

      if (userId === callerUser.id && !isActive) {
        return jsonResponse(
          { error: "No puedes darte de baja a ti mismo desde este panel." },
          400,
        );
      }

      const { data: targetProfile, error: targetProfileError } = await serviceClient
        .from("planner_users")
        .select("id, email, role, is_active")
        .eq("id", userId)
        .maybeSingle();

      if (targetProfileError || !targetProfile) {
        return jsonResponse(
          { error: "No se pudo localizar el usuario indicado." },
          404,
        );
      }

      const { error: updateError } = await serviceClient
        .from("planner_users")
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (updateError) {
        return jsonResponse(
          { error: "No se pudo actualizar el estado del usuario." },
          500,
        );
      }

      return jsonResponse({
        user: {
          id: targetProfile.id,
          email: targetProfile.email,
          role: targetProfile.role,
          isActive,
        },
      });
    }

    return jsonResponse({ error: "Acción no soportada." }, 400);
  } catch (error) {
    console.error(error);

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo gestionar la petición.",
      },
      500,
    );
  }
});
