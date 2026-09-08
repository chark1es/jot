use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalJsonError {
    NonIntegerNumber,
    NonFiniteNumber,
    UnpairedSurrogate,
    UndefinedField(String),
    InvalidValue(&'static str),
}

impl Display for CanonicalJsonError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            CanonicalJsonError::NonIntegerNumber => write!(f, "numbers must be integers"),
            CanonicalJsonError::NonFiniteNumber => write!(f, "numbers must be finite"),
            CanonicalJsonError::UnpairedSurrogate => write!(f, "unpaired surrogate"),
            CanonicalJsonError::UndefinedField(key) => write!(f, "undefined field {key}"),
            CanonicalJsonError::InvalidValue(reason) => write!(f, "invalid value: {reason}"),
        }
    }
}

impl std::error::Error for CanonicalJsonError {}

#[derive(Debug, Clone, PartialEq)]
pub enum CanonicalValue {
    Null,
    Bool(bool),
    Integer(i64),
    String(String),
    Array(Vec<CanonicalValue>),
    Object(BTreeMap<String, CanonicalValue>),
}

pub fn canonicalize(value: &CanonicalValue) -> Result<Vec<u8>, CanonicalJsonError> {
    let mut out = Vec::new();
    emit(value, &mut out)?;
    Ok(out)
}

pub fn canonicalize_to_string(value: &CanonicalValue) -> Result<String, CanonicalJsonError> {
    let bytes = canonicalize(value)?;
    String::from_utf8(bytes).map_err(|_| CanonicalJsonError::InvalidValue("utf8"))
}

fn emit(value: &CanonicalValue, out: &mut Vec<u8>) -> Result<(), CanonicalJsonError> {
    match value {
        CanonicalValue::Null => out.extend_from_slice(b"null"),
        CanonicalValue::Bool(true) => out.extend_from_slice(b"true"),
        CanonicalValue::Bool(false) => out.extend_from_slice(b"false"),
        CanonicalValue::Integer(number) => out.extend_from_slice(number.to_string().as_bytes()),
        CanonicalValue::String(text) => emit_string(text, out),
        CanonicalValue::Array(items) => {
            out.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                emit(item, out)?;
            }
            out.push(b']');
        }
        CanonicalValue::Object(object) => {
            out.push(b'{');
            for (index, (key, field)) in object.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                emit_string(key, out);
                out.push(b':');
                emit(field, out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}

fn emit_string(value: &str, out: &mut Vec<u8>) {
    out.push(b'"');
    for ch in value.chars() {
        let code = ch as u32;
        match code {
            0x22 => out.extend_from_slice(br#"\""#),
            0x5C => out.extend_from_slice(br#"\\"#),
            0x08 => out.extend_from_slice(br#"\b"#),
            0x0C => out.extend_from_slice(br#"\f"#),
            0x0A => out.extend_from_slice(br#"\n"#),
            0x0D => out.extend_from_slice(br#"\r"#),
            0x09 => out.extend_from_slice(br#"\t"#),
            0x00..=0x1F => {
                out.extend_from_slice(b"\\u");
                let hex = format!("{code:04x}");
                out.extend_from_slice(hex.as_bytes());
            }
            _ => {
                let mut buf = [0u8; 4];
                let encoded = ch.encode_utf8(&mut buf);
                out.extend_from_slice(encoded.as_bytes());
            }
        }
    }
    out.push(b'"');
}

#[cfg(test)]
mod tests {
    use super::{canonicalize, canonicalize_to_string, CanonicalValue};
    use std::collections::BTreeMap;

    #[test]
    fn sorts_object_keys_by_utf8() {
        let mut object = BTreeMap::new();
        object.insert("b".to_string(), CanonicalValue::Integer(1));
        object.insert("a".to_string(), CanonicalValue::Integer(2));
        let encoded = canonicalize_to_string(&CanonicalValue::Object(object)).unwrap();
        assert_eq!(encoded, r#"{"a":2,"b":1}"#);
    }

    #[test]
    fn does_not_escape_slash() {
        let encoded =
            canonicalize(&CanonicalValue::String("https://jolt.local".to_string())).unwrap();
        assert_eq!(encoded, br#""https://jolt.local""#);
    }
}
