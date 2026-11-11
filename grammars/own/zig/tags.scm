(source_file
  (function_declaration
    name: (identifier) @name) @definition.function)

(struct_declaration
  (function_declaration
    name: (identifier) @name) @definition.method)

(variable_declaration
  (identifier) @name
  (struct_declaration)) @definition.class

(variable_declaration
  (identifier) @name
  (enum_declaration)) @definition.enum

(variable_declaration
  (identifier) @name
  (union_declaration)) @definition.union

(call_expression
  function: [
    (identifier) @name
    (field_expression
      member: (identifier) @name)
  ]) @reference.call
