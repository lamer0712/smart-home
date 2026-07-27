import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE_NAME, isValidSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const password = process.env.APP_PASSWORD;
  const cookieStore = await cookies();
  const session = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (password && (await isValidSession(session, password))) {
    redirect("/");
  }

  return <LoginForm passwordConfigured={Boolean(password)} />;
}
