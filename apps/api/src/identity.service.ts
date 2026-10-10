import { Injectable } from "@nestjs/common";
import { argon2id, hash, verify } from "argon2";
import { randomBytes } from "node:crypto";
import type { StaffRole } from "@prisma/client";
import { z } from "zod";
import {
  Database,
  fail,
  lock,
  parse,
  uuid,
  label,
  type Tx,
  type RequestContext,
} from "./core.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
} from "./security.js";

export const DEFAULT_PRIVACY_POLICY = `# 高康盃隱私權政策

## 一、適用範圍

本政策適用於高康盃主辦單位透過 Gokan 報名及賽務管理系統所蒐集、處理及利用之個人資料。主辦單位將依中華民國個人資料保護法及其他適用法令辦理個人資料保護事項。

## 二、蒐集之資料類別

為完成帳號管理、社團及聯隊報名、資格審查、隊伍配置、賽程、檢錄、費用結算及賽務聯絡，系統可能蒐集帳號姓名、電子郵件地址、所屬角色、最近登入時間與短期安全計數；社團或聯隊資料、選手姓名、性別、年級、參賽項目及隊伍配置；付款金額、付款日期、付款人及付款參考資訊；以及維護資訊安全所必要且具期限之技術資料。付款證明檔案由使用者選擇提供。

主辦單位不要求提供與前述目的無關之敏感或多餘資料。使用者應確保所提供資料真實、正確且具有合法提供之權限。

## 三、蒐集及利用目的

個人資料僅於下列目的必要範圍內處理及利用：建立及維護帳號、管理社團與報名資格、安排及發布賽程、辦理檢錄與賽務行政、計算及核對費用、處理付款與退款、通知活動事項、處理申訴或爭議、維護資訊安全及履行法定義務。主辦單位不以與上述目的無關之方式利用個人資料。

## 四、利用期間、地區及對象

個人資料於高康盃作業及爭議處理所必要之期間內，於主辦單位所使用之受保護資訊環境中處理。資料僅提供予主辦單位內經授權之工作人員、所屬社團或聯隊之必要作業人員、受主辦單位委託提供系統或賽務服務之服務提供者，以及依法有權要求提供資料之機關或人員。受委託者應依契約及適用法令負保密與安全維護責任。

## 五、資料安全與保存

主辦單位採取權限控管、登入保護、傳輸安全及其他合理之技術與管理措施，防止個人資料遭未經授權之存取、利用、竄改、遺失或揭露。資料於保存期間屆滿、蒐集目的完成或依法無須保存時，將依適用法令及主辦單位保存政策刪除、去識別化或封存。

## 六、當事人權利

本人得依法請求查詢、閱覽、製給複本、補充、更正、停止蒐集或處理，以及刪除其個人資料；但法令另有規定或主辦單位因履行賽務及法定義務而有保存必要者，不在此限。提出請求時，主辦單位得進行身分確認，並於法定期間內回覆。請透過高康盃主辦單位公布之聯絡管道提出資料權利請求。

## 七、未成年人資料

選手如為未成年人，應由其法定代理人或監護人確認其參賽及個人資料提供事宜。提供資料之帳號管理者應確認已取得必要之授權，並負責資料正確性。

## 八、政策修訂

主辦單位得因法令、賽務或系統作業需要修訂本政策。修訂後之版本將於系統公告或發布，必要時要求使用者重新閱讀並作成同意或登入確認。修訂內容自公告或文件所載生效日起適用。

## 九、聯絡方式

如對本政策或個人資料處理有疑義，請透過高康盃主辦單位公布之正式聯絡方式洽詢。`;

export const DEFAULT_TERMS = `# 高康盃使用條款

## 一、條款效力與適用範圍

本使用條款規範使用者使用 Gokan 高康盃報名及賽務管理系統之權利義務。使用者完成註冊、登入、同意或使用系統功能，即表示已閱讀、瞭解並同意受本條款及高康盃主辦單位公布之競賽規程、報名須知及其他作業公告拘束。各項公告與本條款不一致時，就特定賽務事項以該公告之明確規定為準。

## 二、帳號與權限

使用者應提供正確且最新之帳號資料，妥善保管登入憑證，不得出借、轉讓或以他人身分使用系統。使用者僅得在主辦單位授予之角色及社團、聯隊範圍內執行操作；任何繞過權限、探查他人資料、干擾服務或未經授權之自動化行為均屬禁止。發現帳號遭冒用或有安全疑慮時，應立即通知主辦單位。

## 三、報名、資格與資料正確性

報名、選手配置、聯隊組成、賽事資格及隊伍錄取，均依當年度競賽規程、主辦單位公告及系統所示之伺服器驗證結果辦理。使用者應確認其提交之社團、聯隊及選手資料真實、完整且已取得必要授權。系統顯示之草稿、待審核或待錄取狀態，不代表主辦單位已完成最終確認；主辦單位得因資格、名額、時程衝突或其他規程事由退回、調整或拒絕申請。

## 四、費用、付款與退款

報名費、選手費、賽事費、付款期限、付款審核及退款金額，依當年度收費設定、競賽規程及主辦單位公告計算。使用者應於期限內提供正確付款資訊；付款證明為非必要資料時，是否提供不影響提交付款資訊之權利，但提供正確證明可協助審核。任何付款或退款狀態，均以系統及主辦單位審核紀錄為準。

## 五、使用者義務與禁止事項

使用者不得提供虛偽或冒用資料、侵害他人隱私名譽或其他權利、上傳惡意程式或違法侵權內容、未經授權複製反向工程或干擾系統，或利用系統從事違法、欺詐及妨礙賽務之行為。使用者對其帳號所提交之內容及操作負責。

## 六、內容與授權

使用者對其提交之資料及檔案負擔法律責任，並保證具有必要之權利。為履行報名、審核、賽務及客服作業，使用者授予主辦單位於必要範圍內儲存、處理、顯示及傳遞該等內容之非專屬、無償授權。主辦單位不因取得前述作業授權而取得與賽務目的無關之利用權。

## 七、服務調整與中斷

主辦單位得因維護、更新、資安事件、不可抗力或其他合理事由暫停或調整系統功能，並於可行範圍內公告。使用者應自行保留已提交資料及重要通知；系統之草稿或畫面顯示不取代主辦單位正式公告。

## 八、違約處理

使用者違反本條款、競賽規程或法令時，主辦單位得依情節限制功能、暫停或終止帳號、撤回相關操作或報名，並保留依法請求損害賠償及採取其他救濟之權利。前述處理不影響使用者依法享有之程序或權利。

## 九、責任範圍

主辦單位將以合理方式維持系統及賽務資料之正確與安全，但對不可歸責於主辦單位之網路、設備、第三方服務、不可抗力或使用者操作所造成之損失，不負超過適用法令所許可範圍之責任。本條款不得排除或限制依法不得排除或限制之責任。

## 十、條款修訂與準據法

主辦單位得因法令或賽務需要修訂本條款，修訂版本發布後生效；重大變更時將依適當方式通知，必要時要求重新確認。除法律另有強制規定外，本條款以中華民國法律為準據法，因本條款所生爭議以臺灣有管轄權之法院為第一審管轄法院。

## 十一、聯絡方式

如對本條款或系統使用有疑義，請透過高康盃主辦單位公布之正式聯絡方式洽詢。`;

export const password = z.string().min(12).max(256);
export const email = z
  .string()
  .trim()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.string().email());
export const publicUser = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  firstLoginRequired: true,
} as const;
export const passwordHash = (value: string) =>
  hash(value, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export type Identity = Awaited<ReturnType<IdentityService["authenticate"]>>;
@Injectable()
export class IdentityService {
  private dummy = passwordHash(randomBytes(32).toString("hex"));
  constructor(private readonly db: Database) {}
  cookie(token: string, clear = false) {
    return `gokan_session=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 28800}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  }
  async issue(tx: Tx, userId: string) {
    const token = createOpaqueToken();
    await tx.session.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 8 * 3600000),
      },
    });
    return token;
  }
  async login(input: unknown, ip: string) {
    const data = parse(
      z.object({ email, password: z.string().min(1).max(256), entryMode: z.enum(["staff", "leader"]).optional() }).strict(),
      input,
    );
    const accountKey = hashOpaqueToken(data.email);
    const ipKey = hashOpaqueToken(ip);
    const allowed = await this.db.$transaction(async (tx) => {
      await lock(tx, "gokan:login-throttle");
      const since = new Date(Date.now() - 15 * 60000);
      await tx.loginAttempt.deleteMany({ where: { createdAt: { lt: since } } });
      const [account, source, global] = await Promise.all([
        tx.loginAttempt.count({ where: { accountKey, createdAt: { gte: since } } }),
        tx.loginAttempt.count({ where: { sourceKey: ipKey, createdAt: { gte: since } } }),
        tx.loginAttempt.count({ where: { createdAt: { gte: since } } }),
      ]);
      if (account >= 10 || source >= 60 || global >= 1000) return false;
      await tx.loginAttempt.create({ data: { accountKey, sourceKey: ipKey } });
      return true;
    });
    if (!allowed) fail("AUTH_THROTTLED", "登入嘗試過多，請稍後再試", 429);
    const user = await this.db.user.findUnique({
      where: { normalizedEmail: data.email },
    });
    const valid = await verify(
      user?.passwordHash ?? (await this.dummy),
      data.password,
    );
    return this.db
      .$transaction(async (tx) => {
        if (user) await lock(tx, `user:${user.id}`);
        const current =
          user && (await tx.user.findUnique({ where: { id: user.id } }));
        if (
          !valid ||
          !current ||
          current.status !== "ACTIVE" ||
          current.passwordHash !== user?.passwordHash
        ) {
          
          return null;
        }
        if (data.entryMode) {
          const [staff, leader] = await Promise.all([
            tx.activityStaff.findFirst({ where: { userId: current.id, revokedAt: null }, select: { id: true } }),
            tx.organizationMembership.findFirst({ where: { userId: current.id, revokedAt: null, role: { in: ["LEADER", "DEPUTY"] }, organization: { active: true } }, select: { id: true } }),
          ]);
          const allowed = data.entryMode === "staff" ? Boolean(staff) : Boolean(leader);
          if (!allowed) return { mismatch: true } as const;
        }
        const token = await this.issue(tx, current.id);
        await tx.user.update({ where: { id: current.id }, data: { lastLoginAt: new Date() } });
        
        return { token } as const;
      })
      .then((result) => {
        if (result && "mismatch" in result && result.mismatch) fail("AUTH_ENTRY_ROLE_MISMATCH", "請使用符合所選入口的帳號登入。", 403);
        if (!result || !("token" in result) || !result.token) fail("AUTH_INVALID_CREDENTIALS", "帳號或密碼不正確", 401);
        return result.token;
      });
  }
  async authenticate(request: RequestContext, onboarding = false) {
    const raw = request.headers.cookie;
    const cookie =
      typeof raw === "string"
        ? raw
            .split(";")
            .map((v) => v.trim())
            .find((v) => v.startsWith("gokan_session="))
            ?.slice(14)
        : undefined;
    if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie))
      fail("AUTH_REQUIRED", "請先登入", 401);
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashOpaqueToken(cookie) },
      include: { user: { select: publicUser } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      fail("AUTH_REQUIRED", "登入已到期，請重新登入", 401);
    if (session.user.status !== "ACTIVE")
      fail("AUTH_USER_DISABLED", "帳號已停用", 401);
    const policy = await this.db.policyDocument.findFirst({
      where: { required: true, publishedAt: { lte: new Date() } },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    });
    const consent =
      policy &&
      (await this.db.userConsent.findUnique({
        where: {
          userId_policyDocumentId: {
            userId: session.userId,
            policyDocumentId: policy.id,
          },
        },
      }));
    const leaderMembership = policy && (await this.db.organizationMembership.findFirst({
      where: {
        userId: session.userId,
        revokedAt: null,
        role: { in: ["LEADER", "DEPUTY"] },
        organization: { active: true },
      },
      select: { id: true },
    }));
    const staffAssignment = await this.db.activityStaff.findFirst({ where: { userId: session.userId, revokedAt: null }, select: { id: true } });
    const staffUser = Boolean(staffAssignment);
    const sessionAcknowledgementRequired = Boolean(policy && leaderMembership);
    const sessionAcknowledged = !sessionAcknowledgementRequired || (
      session.acknowledgedPolicyDocumentId === policy?.id && Boolean(session.acknowledgedAt)
    );
    if (!onboarding && session.user.firstLoginRequired)
      fail("AUTH_FIRST_LOGIN_REQUIRED", "請先變更臨時密碼", 403);
    if (!onboarding && !staffUser && (!policy || !consent))
      fail("CONSENT_REQUIRED", "請先閱讀並同意目前的個人資料告知事項", 403);
    if (!onboarding && !sessionAcknowledged)
      fail("SESSION_ACK_REQUIRED", "請先確認本次登入的高康盃告知事項", 403);
    await this.db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    return {
      user: session.user,
      sessionId: session.id,
      policy,
      consentRequired: !staffUser && !consent,
      sessionAcknowledgementRequired: sessionAcknowledgementRequired && !sessionAcknowledged,
    };
  }
  async staff(tx: Tx, userId: string, activityId: string, roles: StaffRole[]) {
    const assignment = await tx.activityStaff.findFirst({
      where: {
        userId,
        activityId,
        revokedAt: null,
        user: { status: "ACTIVE" },
      },
    });
    if (!assignment || !roles.includes(assignment.role))
      fail("FORBIDDEN", "您沒有此操作權限", 403);
    return assignment;
  }
  async club(tx: Tx, userId: string, organizationId: string) {
    const membership = await tx.organizationMembership.findFirst({
      where: {
        userId,
        organizationId,
        revokedAt: null,
        organization: { active: true },
        user: { status: "ACTIVE" },
      },
      include: { organization: true },
    });
    if (!membership) fail("FORBIDDEN", "您沒有此社團的操作權限", 403);
    return membership.organization;
  }
  async me(request: RequestContext) {
    const identity = await this.authenticate(request, true);
    if (identity.user.firstLoginRequired || identity.consentRequired)
      return { ...identity, assignments: [], memberships: [] };
    const [assignments, memberships] = await Promise.all([
      this.db.activityStaff.findMany({
        where: { userId: identity.user.id, revokedAt: null },
        include: { activity: true },
      }),
      this.db.organizationMembership.findMany({
        where: {
          userId: identity.user.id,
          revokedAt: null,
          organization: { active: true },
        },
        include: { organization: true },
      }),
    ]);
    return { ...identity, assignments, memberships };
  }
  async changePassword(request: RequestContext, input: unknown) {
    const identity = await this.authenticate(request, true);
    const data = parse(
      z
        .object({
          currentPassword: z.string().min(1).max(256),
          newPassword: password,
        })
        .strict(),
      input,
    );
    if (data.currentPassword === data.newPassword)
      fail("VALIDATION_FAILED", "新密碼必須與目前密碼不同", 422);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: identity.user.id },
    });
    if (!(await verify(user.passwordHash, data.currentPassword)))
      fail("AUTH_INVALID_CREDENTIALS", "目前密碼不正確", 401);
    const newHash = await passwordHash(data.newPassword);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `user:${user.id}`);
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      const session = await tx.session.findUniqueOrThrow({
        where: { id: identity.sessionId },
      });
      if (
        current.status !== "ACTIVE" ||
        current.passwordHash !== user.passwordHash ||
        session.revokedAt
      )
        fail("AUTH_REQUIRED", "請重新登入", 401);
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          firstLoginRequired: false,
          passwordChangedAt: new Date(),
        },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const token = await this.issue(tx, user.id);
      
      return token;
    });
  }
  async consent(request: RequestContext, input: unknown) {
    const identity = await this.authenticate(request, true);
    if (identity.user.firstLoginRequired)
      fail("AUTH_FIRST_LOGIN_REQUIRED", "請先變更臨時密碼", 403);
    const data = parse(
      z.object({ policyId: uuid, accepted: z.literal(true) }).strict(),
      input,
    );
    if (!identity.policy || identity.policy.id !== data.policyId)
      fail("STALE_VERSION", "告知事項已更新，請重新閱讀");
    await this.db.$transaction(async (tx) => {
      await tx.userConsent.upsert({
        where: {
          userId_policyDocumentId: {
            userId: identity.user.id,
            policyDocumentId: data.policyId,
          },
        },
        create: { userId: identity.user.id, policyDocumentId: data.policyId },
        update: {},
      });
      
    });
  }

  async acknowledgeSession(request: RequestContext, input: unknown) {
    const identity = await this.authenticate(request, true);
    const data = parse(z.object({ policyId: uuid, accepted: z.literal(true) }).strict(), input);
    if (!identity.policy || identity.policy.id !== data.policyId)
      fail("STALE_VERSION", "告知事項已更新，請重新閱讀");
    await this.db.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.findFirst({
        where: { userId: identity.user.id, revokedAt: null, role: { in: ["LEADER", "DEPUTY"] }, organization: { active: true } },
        select: { id: true },
      });
      if (!membership) return;
      await tx.session.update({ where: { id: identity.sessionId }, data: { acknowledgedPolicyDocumentId: data.policyId, acknowledgedAt: new Date() } });
      
    });
    return { success: true };
  }
  async logout(request: RequestContext) {
    const raw = request.headers.cookie;
    const token = typeof raw === "string"
      ? raw.split(";").map((value) => value.trim()).find((value) => value.startsWith("gokan_session="))?.slice(14)
      : undefined;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const session = await this.db.session.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
    if (!session || session.revokedAt) return;
    await this.db.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      
    });
  }
  async bootstrap(input: unknown) {
    const data = parse(
      z
        .object({
          email,
          displayName: label,
          temporaryPassword: password,
          year: z.number().int().min(2020).max(2200),
        })
        .strict(),
      input,
    );
    const encoded = await passwordHash(data.temporaryPassword);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "gokan:bootstrap");
      if (
        (await tx.activity.count()) ||
        (await tx.activityStaff.count()) ||
        (await tx.user.count())
      )
        fail("BOOTSTRAP_EXISTS", "初始管理基準已存在，禁止重複初始化");
      const user = await tx.user.create({
        data: {
          email: data.email,
          normalizedEmail: data.email,
          displayName: data.displayName,
          passwordHash: encoded,
        },
      });
      const activity = await tx.activity.create({
        data: {
          code: `GOKAN-${data.year}`,
          name: `${data.year} 高康盃`,
          year: data.year,
        },
      });
      await tx.activityStaff.create({
        data: {
          userId: user.id,
          activityId: activity.id,
          role: "SYSTEM_ADMIN",
        },
      });
      await tx.policyDocument.create({
        data: {
          version: "v1",
          title: "高康盃隱私權政策",
          bodyMarkdown: DEFAULT_PRIVACY_POLICY,
          publishedAt: new Date(),
        },
      });
      await tx.policyDocument.create({
        data: {
          version: "TERMS::v1",
          title: "高康盃使用條款",
          bodyMarkdown: DEFAULT_TERMS,
          required: false,
          publishedAt: new Date(),
        },
      });
      
      return { userId: user.id, activityId: activity.id };
    });
  }
}
