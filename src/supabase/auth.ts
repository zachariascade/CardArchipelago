import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "./client";

export type SupabaseAuthState = {
  user: User | null;
  isLoading: boolean;
  error?: string;
};

export function useSupabaseAuth(): SupabaseAuthState {
  const [state, setState] = useState<SupabaseAuthState>({
    user: null,
    isLoading: Boolean(supabase),
  });

  useEffect(() => {
    if (!supabase) return;

    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      setState({
        user: data.session?.user ?? null,
        isLoading: false,
        error: error?.message,
      });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        isLoading: false,
      });
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function sendSupabaseMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString(),
    },
  });
  if (error) throw new Error(error.message);
}

export async function signOutOfSupabase(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function refreshSupabaseSession(): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: currentSession, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!currentSession.session) throw new Error("Sign in before using cloud sync.");

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw new Error(getSupabaseAuthErrorMessage(refreshError.message));
  }
}

function getSupabaseAuthErrorMessage(message: string): string {
  if (message.toLowerCase().includes("jwt issued at future")) {
    return "Supabase rejected the current session token because its timestamp is in the future. Sign out and sign back in; if it keeps happening, check that your device date, time, and time zone are set automatically.";
  }
  return message;
}
