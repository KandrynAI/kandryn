import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoherence, buildRepoSymbolIndex } from "./index.js";
import type { SuggestionFile as SF } from "../../../../../shared/types/codeSuggestion.js";

function sf(filePath: string, content: string, op: SF["op"] = "create"): SF {
  return { seq: 0, op, filePath, content, resolved: true, applyStatus: "applied", linesAdded: 0, linesRemoved: 0 };
}

const noRepo = buildRepoSymbolIndex([]);
const P = "src/main/java/com/app";

// An interface mixing an abstract method with a default, a static, and a private
// method — only the abstract one is part of the implement contract (Q3).
const ithing = `package com.app;
public interface IThing {
    void doIt(int x);
    default void baz() { }
    static IThing create() { return null; }
    private void helper() { }
}`;

// 1 — Q3: an implementor that provides only the abstract method passes, and a
// default method stays callable on the interface-typed receiver.
test("default/static/private interface methods are NOT required; default stays callable", () => {
  const thing = `package com.app;
public class Thing implements IThing {
    public void doIt(int x) { }
}`;
  const client = `package com.app;
public class Client {
    private final IThing thing;
    public Client(IThing thing) { this.thing = thing; }
    public void run() { this.thing.baz(); }
}`;
  const r = checkCoherence([sf(`${P}/IThing.java`, ithing), sf(`${P}/Thing.java`, thing), sf(`${P}/Client.java`, client)], noRepo);
  assert.equal(r.findings.length, 0, `expected zero findings, got ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "passed");
});

// 2 — interface_impl: a missing ABSTRACT method is flagged; the default/static/
// private ones are NOT (Q3 negative side).
test("missing abstract method → interface_impl error; default/static/private never flagged", () => {
  const thing2 = `package com.app;
public class Thing2 implements IThing {
    public void other() { }
}`;
  const r = checkCoherence([sf(`${P}/IThing.java`, ithing), sf(`${P}/Thing2.java`, thing2)], noRepo);
  assert.ok(
    r.findings.some((f) => f.check === "interface_impl" && /doIt/.test(f.message)),
    `expected an interface_impl error for doIt, got ${JSON.stringify(r.findings)}`,
  );
  assert.ok(
    !r.findings.some((f) => /baz|create|helper/.test(f.message)),
    `default/static/private methods must never be flagged, got ${JSON.stringify(r.findings)}`,
  );
});

// 3 — caller_callee: a call to a missing method on a typed field is an error.
test("call to a missing method on a resolved receiver → caller_callee error", () => {
  const repo = `package com.app;
public class Repo {
    public void get(int id) { }
}`;
  const svc = `package com.app;
public class Svc {
    private final Repo repo;
    public Svc(Repo repo) { this.repo = repo; }
    public void load() { this.repo.refresh(); }
}`;
  const r = checkCoherence([sf(`${P}/Repo.java`, repo), sf(`${P}/Svc.java`, svc)], noRepo);
  assert.ok(
    r.findings.some((f) => f.check === "caller_callee" && /refresh/.test(f.message)),
    `expected a caller_callee error for refresh, got ${JSON.stringify(r.findings)}`,
  );
});

// 4 — type_resolution: a referenced type defined nowhere and not imported.
test("referenced type not defined or imported → type_resolution warning", () => {
  const a = `package com.app;
public class Holder {
    private Coverage coverage;
}`;
  const b = `package com.app;
public class Other { }`;
  const r = checkCoherence([sf(`${P}/Holder.java`, a), sf(`${P}/Other.java`, b)], noRepo);
  assert.ok(
    r.findings.some((f) => f.check === "type_resolution" && /Coverage/.test(f.message)),
    `expected a type_resolution finding for Coverage, got ${JSON.stringify(r.findings)}`,
  );
});

// 5 — imports: a cross-package change-set type used without/with/via-wildcard import.
test("import completeness: missing import warns, explicit or wildcard import passes", () => {
  const policy = `package com.app.model;
public class Policy { }`;
  const ctrl = (imp: string) => `package com.app.web;
${imp}
public class Ctrl {
    private Policy policy;
}`;
  const missing = checkCoherence([sf(`${P}/model/Policy.java`, policy), sf(`${P}/web/Ctrl.java`, ctrl(""))], noRepo);
  assert.ok(
    missing.findings.some((f) => f.check === "imports" && /Policy/.test(f.message)),
    `expected an imports warning, got ${JSON.stringify(missing.findings)}`,
  );

  const explicit = checkCoherence([sf(`${P}/model/Policy.java`, policy), sf(`${P}/web/Ctrl.java`, ctrl("import com.app.model.Policy;"))], noRepo);
  assert.equal(explicit.findings.length, 0, `explicit import should clear findings, got ${JSON.stringify(explicit.findings)}`);

  const wildcard = checkCoherence([sf(`${P}/model/Policy.java`, policy), sf(`${P}/web/Ctrl.java`, ctrl("import com.app.model.*;"))], noRepo);
  assert.equal(wildcard.findings.length, 0, `wildcard import should clear findings, got ${JSON.stringify(wildcard.findings)}`);
});

// 6 — Lombok: a @Data class is opaque, so a call to a generated getter is not a
// false positive even though the class has other real methods.
test("Lombok @Data class → caller_callee fails open on generated methods", () => {
  const user = `package com.app;
import lombok.Data;
@Data
public class User {
    private String name;
    public void touch() { }
}`;
  const svc = `package com.app;
public class UserSvc {
    private final User user;
    public UserSvc(User user) { this.user = user; }
    public String show() { return this.user.getName(); }
}`;
  const r = checkCoherence([sf(`${P}/User.java`, user), sf(`${P}/UserSvc.java`, svc)], noRepo);
  assert.equal(r.findings.length, 0, `Lombok getters must not false-fire, got ${JSON.stringify(r.findings)}`);
  assert.ok(r.skipped.some((s) => /Lombok/.test(s.reason)));
});

// 7 — False-positive guard: idiomatic Spring (annotations, DI field, generics)
// produces zero findings.
test("idiomatic Spring produces zero false positives", () => {
  const policy = `package com.app;
public class Policy {
    private Long id;
}`;
  const service = `package com.app;
import java.util.List;
public interface PolicyService {
    List<Policy> findAll();
}`;
  const controller = `package com.app;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.List;

@RestController
public class PolicyController {
    @Autowired
    private PolicyService policyService;

    public List<Policy> list() {
        return this.policyService.findAll();
    }
}`;
  const r = checkCoherence([sf(`${P}/Policy.java`, policy), sf(`${P}/PolicyService.java`, service), sf(`${P}/PolicyController.java`, controller)], noRepo);
  assert.equal(r.findings.length, 0, `expected zero false positives, got ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "passed");
});

// 8 — Dispatch: Java routes through the registry; mixing languages passes cleanly.
test("mixed Java + Python → clean pass with a skip note", () => {
  const r = checkCoherence([sf(`${P}/Thing.java`, "package com.app;\npublic class Thing { }"), sf("app/x.py", "class X:\n    pass")], noRepo);
  assert.equal(r.status, "passed");
  assert.ok(r.skipped.some((s) => /mixed/.test(s.reason)));
});
