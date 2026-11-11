(config_file
  (body
    (block
      (identifier) @_kind
      .
      (string_lit)
      .
      (string_lit
        (template_literal) @name)
      (#any-of? @_kind "resource" "data")) @definition.class))

(config_file
  (body
    (block
      (identifier) @_kind
      .
      (string_lit
        (template_literal) @name)
      .
      (block_start)
      (#any-of? @_kind "variable" "output" "module" "provider")) @definition.module))

(function_call
  (identifier) @name) @reference.call
