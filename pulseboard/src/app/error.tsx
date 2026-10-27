"use client";
export default function Error({ error }: { error: Error }) {
  const forbidden = error.message.startsWith("Forbidden");
  return (
    <main className="mx-auto max-w-md p-12 text-center">
      <h1 className="text-xl font-semibold">{forbidden ? "Access denied" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-slate-500">{forbidden ? "Your role doesn't allow this action." : "Please try again."}</p>
    </main>
  );
}
