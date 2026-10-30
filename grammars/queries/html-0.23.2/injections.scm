((script_element
  (start_tag
    (attribute
      (attribute_name) @_name
      (quoted_attribute_value (attribute_value) @_lang)))
  (raw_text) @injection.content)
 (#eq? @_name "lang")
 (#any-of? @_lang "ts" "typescript")
 (#set! injection.language "typescript"))

((script_element
  (start_tag
    (attribute
      (attribute_name) @_name
      (quoted_attribute_value (attribute_value) @_lang)))
  (raw_text) @injection.content)
 (#eq? @_name "lang")
 (#eq? @_lang "tsx")
 (#set! injection.language "tsx"))

((script_element (raw_text) @injection.content)
 (#set! injection.language "javascript"))
