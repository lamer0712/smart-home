"use client";

import { AlertCircle, Loader2, Lock } from "lucide-react";
import { FormEvent, useState } from "react";

export function LoginForm({
  passwordConfigured,
  onSuccess,
}: {
  passwordConfigured: boolean;
  onSuccess?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    passwordConfigured ? null : "APP_PASSWORD 환경 변수가 설정되지 않았습니다.",
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "로그인에 실패했습니다.");
      }

      if (onSuccess) {
        onSuccess();
        return;
      }

      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sky-700">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-950">비밀번호</h1>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={loading || !passwordConfigured}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-5 h-12 w-full rounded-md border border-slate-300 px-3 text-base font-semibold text-slate-950 outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="비밀번호"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !passwordConfigured || password.length === 0}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          들어가기
        </button>
      </form>
    </main>
  );
}
