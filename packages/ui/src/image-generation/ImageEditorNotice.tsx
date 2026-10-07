export function ImageEditorNotice({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <div className="mx-auto max-h-16 w-full max-w-2xl shrink-0 overflow-auto px-4 pb-2 text-ui-sm">
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : (
        <p role="status" className="break-all text-foreground-subtle">
          {notice}
        </p>
      )}
    </div>
  );
}
