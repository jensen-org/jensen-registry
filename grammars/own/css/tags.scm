(class_selector
  (class_name) @name) @definition.class

(id_selector
  (id_name) @name) @definition.class

(keyframes_statement
  (keyframes_name) @name) @definition.function

(declaration
  (property_name) @name
  (#match? @name "^--")) @definition.variable

(call_expression
  (function_name) @name) @reference.call
