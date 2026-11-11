(package_header
  (qualified_identifier) @name) @definition.module

(class_declaration
  name: (identifier) @name) @definition.class

(object_declaration
  name: (identifier) @name) @definition.object

(class_body
  (function_declaration
    name: (identifier) @name) @definition.method)

(source_file
  (function_declaration
    name: (identifier) @name) @definition.function)

(type_alias
  type: (identifier) @name) @definition.type

(source_file
  (property_declaration
    (variable_declaration
      (identifier) @name)) @definition.constant)

(call_expression
  [
    (identifier) @name
    (navigation_expression
      (identifier) @name .)
  ]) @reference.call

(delegation_specifier
  [
    (user_type
      (identifier) @name)
    (constructor_invocation
      (user_type
        (identifier) @name))
  ]) @reference.implementation
