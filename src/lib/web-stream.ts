/**
 * `ReadableStream.from` has been standard since Node 20 but is missing from the
 * DOM lib typings this project compiles against, so the cast lives here once
 * rather than at each call site.
 *
 * It is used in preference to `Readable.toWeb`, which double-closes its
 * controller under Next's route handlers and throws an uncaughtException that
 * would take the server process down.
 */
export function toWebStream(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): ReadableStream<Uint8Array> {
  const factory = ReadableStream as unknown as {
    from: (
      it: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    ) => ReadableStream<Uint8Array>;
  };
  return factory.from(source);
}
