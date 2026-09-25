# DuckDB デバッグメモ

flaker は DuckDB の Node バインディングとして `@duckdb/node-api` を使います（0.14.1 から。以前は `duckdb` パッケージ）。
ネイティブ部分はプラットフォーム別の `@duckdb/node-bindings-<os>-<arch>` パッケージに同梱済みで、インストール時のビルドは不要です。

`Failed to load DuckDB native binding` が出る場合は、次の順に確認してください。

1. `node_modules/@duckdb/` にこのプラットフォーム用の `node-bindings-*` があるか確認（`--no-optional` / `--omit=optional` でインストールすると入りません）
2. 依存関係を入れ直す: `pnpm install --force` または `npm install`
3. `flaker doctor` で `duckdb` チェックが通るか確認

## ファイルロック

DuckDB はファイル単位のシングルライターです。`DuckDBStore.close()` はロックを即座に解放するので、同じプロセスで close した直後に別プロセスが同じファイルを開けます。
旧 `duckdb` バインディングでは close 後もオブジェクトが GC されるまでロックが残っていました (#106)。
