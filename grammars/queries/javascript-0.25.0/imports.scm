(import_statement source: (string) @import)
(export_statement source: (string) @import)
(call_expression function: (import) arguments: (arguments (string) @import))
(call_expression function: (identifier) @_require arguments: (arguments (string) @import) (#eq? @_require "require"))
