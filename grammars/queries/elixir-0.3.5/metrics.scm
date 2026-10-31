(call target: (identifier) @_t (#match? @_t "^(def|defp|defmacro|defmacrop|defguard|defguardp|defdelegate)$")) @function
(anonymous_function) @function
(stab_clause left: (arguments (_) @parameter))
(call target: (identifier) @_t (#match? @_t "^(if|unless|cond|case|with)$")) @branch
(stab_clause) @branch
(else_block) @branch
(rescue_block) @branch
(catch_block) @branch
(call target: (identifier) @_t (#match? @_t "^for$")) @loop
(binary_operator operator: ["and" "or" "&&" "||"]) @boolean
(call target: (identifier) @_t (#match? @_t "^(if|unless|cond|case|with|for|try|receive)$")) @nesting
(anonymous_function) @nesting
