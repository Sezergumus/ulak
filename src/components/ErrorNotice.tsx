export function ErrorNotice({
  error,
  message = "This action could not be completed. Try again.",
}: {
  error: string;
  message?: string;
}) {
  return (
    <div className="inline-error" role="alert">
      <p>{message}</p>
      <details>
        <summary>Error details</summary>
        <p>{error}</p>
      </details>
    </div>
  );
}
