import { FormEvent, useState } from "react";
import { Flex } from "@radix-ui/themes";
import TextField from "./TextField";

export default function TextFieldStories() {
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [code, setCode] = useState("");
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const handleValidationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (event.currentTarget.checkValidity()) {
      setFormMessage("Form passed native validation.");
    } else {
      setFormMessage("Form failed native validation.");
    }
  };

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="3" maxWidth="360px">
        <TextField
          label="Size x-small"
          size="x-small"
          placeholder="Text input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="Size small (default)"
          placeholder="Text input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="Size legacy"
          size="legacy"
          placeholder="Text input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="Size medium"
          size="medium"
          placeholder="Text input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Flex>

      <Flex direction="column" gap="3" maxWidth="360px">
        <TextField
          label="With help text"
          placeholder="Enter a value"
          helpText="This is some helpful context for the field."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="With error"
          placeholder="Enter a value"
          error="This field is required."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="With warning"
          placeholder="Enter a value"
          error="Value looks unusual."
          errorLevel="warning"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="Disabled"
          placeholder="Cannot edit"
          disabled
          value="Read only"
          onChange={() => {}}
        />
        <TextField
          label="With prepend"
          placeholder="0.00"
          prepend="$"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="With append"
          placeholder="Duration"
          append="days"
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="Required mark (visual only)"
          placeholder="Enter a value"
          markRequired
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Flex>

      <Flex direction="column" gap="3" maxWidth="360px">
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Number with min / max / step"
          type="number"
          name="quantity"
          min={1}
          max={10}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <TextField
          label="Pattern + title"
          name="code"
          placeholder="ABC-123"
          pattern="[A-Z]{3}-[0-9]{3}"
          title="Use format ABC-123"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Flex>

      <form onSubmit={handleValidationSubmit} noValidate={false}>
        <Flex direction="column" gap="3" maxWidth="360px">
          <TextField
            label="Required email (HTML validation)"
            type="email"
            name="signup-email"
            required
            markRequired
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Min length 8"
            type="password"
            name="signup-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Submit for validation</button>
          {formMessage ? <div>{formMessage}</div> : null}
        </Flex>
      </form>
    </Flex>
  );
}
