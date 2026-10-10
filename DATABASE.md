# Gokan 資料結構與欄位字典

此文件依 [Prisma schema](packages/database/prisma/schema.prisma) 與 [001_initial SQL](packages/database/prisma/migrations/001_initial/migration.sql) 描述目前資料模型。**SQL 僅適用新空 PostgreSQL 資料庫的初始化，不是既有營運資料庫升級指南。** 概念及操作流程見 [README](README.md)。Showcase 的虛構瀏覽器狀態不使用此資料庫。

## 讀表方式

Prisma 欄位若有 `@map`，括號顯示實際 SQL 欄名；模型標題同時列 `@@map` 資料表名。型別後的 `?` 表可空；`[]` 是陣列；`@db.Uuid`、`@db.Timestamptz`、`@db.JsonB` 是明定 PostgreSQL 型別。未註 `@db` 的型別依 Prisma PostgreSQL 映射。表格的「鍵／關聯／索引」顯示 schema 中的鍵與索引；後面的 SQL 對照另列手寫 CHECK／trigger。每個模型的 `id` 均為資料庫產生 UUID 主鍵。

## 枚舉狀態

以下值直接取自目前 Prisma schema；狀態可否轉換仍由服務與階段判定。

| Prisma enum（SQL 名） | 值 |
| --- | --- |
| `UserStatus`（`user_status`） | `ACTIVE`、`DISABLED` |
| `ActivityStatus`（`activity_status`） | `DRAFT`、`ACTIVE`、`ARCHIVED` |
| `StaffRole`（`staff_role`） | `SYSTEM_ADMIN`、`REGISTRATION_FINANCE`、`CHECKIN_EXPORT` |
| `OrganizationMemberRole`（`organization_member_role`） | `LEADER`、`DEPUTY` |
| `ParticipantGender`（`participant_gender`） | `MALE`、`FEMALE` |
| `ParticipantGrade`（`participant_grade`） | `GRADE_1`、`GRADE_2`、`GRADE_3` |
| `LeagueStatus`（`league_status`） | `PENDING_CONFIRMATION`、`ACTIVE`、`DISSOLVED` |
| `LeagueMemberStatus`（`league_member_status`） | `PENDING`、`CONFIRMED` |
| `LeagueQualificationMode`（`league_qualification_mode`） | `ANY`、`ALL` |
| `RegistrationStatus`（`registration_status`） | `DRAFT`、`SUBMITTED`、`RETURNED`、`CONFIRMED` |
| `ScheduleVersionStatus`（`schedule_version_status`） | `DRAFT`、`PUBLISHED`、`ARCHIVED` |
| `EventEntrySource`（`event_entry_source`） | `REGISTRATION`、`LEADER_MEETING` |
| `TeamAdmissionStatus`（`team_admission_status`） | `PENDING`、`ADMITTED`、`REJECTED` |
| `PaymentStatus`（`payment_status`） | `SUBMITTED`、`CONFIRMED`、`REJECTED` |
| `RefundStatus`（`refund_status`） | `REQUESTED`、`COMPLETED`、`CANCELLED` |
| `AttachmentPurpose`（`attachment_purpose`） | `PAYMENT_PROOF`、`TOTAL_ROSTER` |
| `LeaderMeetingStatus`（`leader_meeting_status`） | `SCHEDULED`、`ENTRY_OPEN`、`ENTRY_CLOSED_PARTICIPANT_OPEN`、`CLOSED` |
| `LeaderMeetingSnapshotKind`（`leader_meeting_snapshot_kind`） | `BASELINE`、`FINAL` |

## `User` → `users`

登入身分；年度職務和社團成員資格另存，不等於使用者全域角色。 主要建立／更新者：[AccountsController](apps/api/src/accounts.controller.ts)／[IdentityService](apps/api/src/identity.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 認證／個資；帳號管理／IdentityService |
| `email` | `String`；必填 | — | — | 登入 Email | 認證／個資；帳號管理／IdentityService |
| `normalizedEmail` (`normalized_email`) | `String`；必填 | — | 唯一 | 正規化後的唯一登入 Email | 認證／個資；帳號管理／IdentityService |
| `displayName` (`display_name`) | `String`；必填 | — | — | 顯示姓名 | 認證／個資；帳號管理／IdentityService |
| `passwordHash` (`password_hash`) | `String`；必填 | — | — | 密碼 Argon2id 雜湊 | 認證／個資；帳號管理／IdentityService |
| `status` | `UserStatus`；必填 | `ACTIVE` | — | 目前狀態；可用轉換由服務判定 | 認證／個資；帳號管理／IdentityService |
| `firstLoginRequired` (`first_login_required`) | `Boolean`；必填 | `true` | — | 登入後必須先改臨時密碼 | 認證／個資；帳號管理／IdentityService |
| `passwordChangedAt` (`password_changed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 最近密碼更新時間 | 認證／個資；帳號管理／IdentityService |
| `lastLoginAt` (`last_login_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 最近成功登入時間 | 認證／個資；帳號管理／IdentityService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 認證／個資；帳號管理／IdentityService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 認證／個資；帳號管理／IdentityService |

## `Session` → `sessions`

產品登入工作階段；資料庫存 tokenHash 而非 Cookie 原值。 主要建立／更新者：[IdentityService](apps/api/src/identity.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 認證／個資；IdentityService |
| `userId` (`user_id`) | `String (@db.Uuid)`；必填 | — | FK→User；索引(userId, expiresAt) | 關聯登入使用者 | 認證／個資；IdentityService |
| `tokenHash` (`token_hash`) | `String`；必填 | — | 唯一 | 隨機工作階段 token 的 SHA-256 雜湊 | 認證／個資；IdentityService |
| `expiresAt` (`expires_at`) | `DateTime (@db.Timestamptz)`；必填 | — | 索引(userId, expiresAt) | 工作階段到期時間 | 認證／個資；IdentityService |
| `revokedAt` (`revoked_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 撤銷時間；可空代表尚未撤銷 | 認證／個資；IdentityService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 認證／個資；IdentityService |
| `lastSeenAt` (`last_seen_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 最近認證存取時間 | 認證／個資；IdentityService |
| `acknowledgedPolicyDocumentId` (`acknowledged_policy_document_id`) | `String? (@db.Uuid)`；可空 | — | FK→PolicyDocument | 本工作階段確認的告知版本 | 認證／個資；IdentityService |
| `acknowledgedAt` (`acknowledged_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 本次登入告知確認時間 | 認證／個資；IdentityService |

## `PolicyDocument` → `policy_documents`

已發布的告知事項與條款版本。 主要建立／更新者：[IdentityService.bootstrap](apps/api/src/identity.service.ts)／[LegalService](apps/api/src/legal.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；bootstrap／LegalService |
| `version` | `String`；必填 | — | 唯一 | 版本號或文件版次 | 一般賽務資料；bootstrap／LegalService |
| `title` | `String`；必填 | — | — | 文件標題 | 一般賽務資料；bootstrap／LegalService |
| `bodyMarkdown` (`body_markdown`) | `String`；必填 | — | — | 政策或條款的 Markdown 內容 | 一般賽務資料；bootstrap／LegalService |
| `required` | `Boolean`；必填 | `true` | — | 是否必須接受 | 一般賽務資料；bootstrap／LegalService |
| `publishedAt` (`published_at`) | `DateTime (@db.Timestamptz)`；必填 | — | — | 發布時間 | 一般賽務資料；bootstrap／LegalService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；bootstrap／LegalService |

## `UserConsent` → `user_consents`

使用者對指定必須政策版本的同意。 主要建立／更新者：[IdentityService](apps/api/src/identity.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 個資或身分關聯；IdentityService |
| `userId` (`user_id`) | `String (@db.Uuid)`；必填 | — | FK→User；複合唯一(userId, policyDocumentId) | 關聯登入使用者 | 個資或身分關聯；IdentityService |
| `policyDocumentId` (`policy_document_id`) | `String (@db.Uuid)`；必填 | — | FK→PolicyDocument；複合唯一(userId, policyDocumentId) | 同意的政策版本 | 個資或身分關聯；IdentityService |
| `acceptedAt` (`accepted_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 接受政策的時間 | 個資或身分關聯；IdentityService |

## `Activity` → `activities`

一屆年度活動；年度與時間窗是其他賽務資料的範圍。 主要建立／更新者：[IdentityService.bootstrap](apps/api/src/identity.service.ts)／[ActivityController](apps/api/src/activity.controller.ts)／[FinanceService](apps/api/src/finance.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `code` | `String`；必填 | — | 唯一 | 年度內識別代碼 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `name` | `String`；必填 | — | — | 顯示名稱 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `year` | `Int`；必填 | — | 唯一 | 年度數字 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `timezone` | `String`；必填 | `"Asia/Taipei"` | — | 年度時區設定 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `status` | `ActivityStatus`；必填 | `DRAFT` | — | 目前狀態；可用轉換由服務判定 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `registrationOpensAt` (`registration_opens_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 報名開始時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `registrationClosesAt` (`registration_closes_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 報名截止時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `paymentDueAt` (`payment_due_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 繳費期限 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `leaderMeetingStartsAt` (`leader_meeting_starts_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 領隊會議開始時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `leaderMeetingEndsAt` (`leader_meeting_ends_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 領隊會議結束時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `competitionStartsAt` (`competition_starts_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 比賽開始時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `competitionEndsAt` (`competition_ends_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 比賽結束時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `remittanceInstructions` (`remittance_instructions`) | `String?`；可空 | — | — | 給報名單位的匯款說明 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；bootstrap／ActivityController／FinanceService |

## `LeaderMeeting` → `leader_meetings`

當年度領隊會議階段及執行者。 主要建立／更新者：[LeaderMeetingService](apps/api/src/leader-meeting.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；LeaderMeetingService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | 唯一；FK→Activity；索引(activityId, status) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；LeaderMeetingService |
| `status` | `LeaderMeetingStatus`；必填 | `SCHEDULED` | 索引(activityId, status) | 目前狀態；可用轉換由服務判定 | 一般賽務資料；LeaderMeetingService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；LeaderMeetingService |
| `startedAt` (`started_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 會議開始時間 | 一般賽務資料；LeaderMeetingService |
| `entryClosedAt` (`entry_closed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 停止賽事項目異動的時間 | 一般賽務資料；LeaderMeetingService |
| `closedAt` (`closed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 會議正式關閉時間 | 一般賽務資料；LeaderMeetingService |
| `startedById` (`started_by_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 啟動會議的管理員 | 個資或身分關聯；LeaderMeetingService |
| `entryClosedById` (`entry_closed_by_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 收束項目的管理員 | 個資或身分關聯；LeaderMeetingService |
| `closedById` (`closed_by_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 關閉會議的管理員 | 個資或身分關聯；LeaderMeetingService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；LeaderMeetingService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；LeaderMeetingService |

## `LeaderMeetingSnapshot` → `leader_meeting_snapshots`

保存領隊會議開始時的基準資料與結束時的最終業務資料。 主要建立／更新者：[LeaderMeetingService](apps/api/src/leader-meeting.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 金流／可能個資；LeaderMeetingService |
| `leaderMeetingId` (`leader_meeting_id`) | `String (@db.Uuid)`；必填 | — | FK→LeaderMeeting；複合唯一(leaderMeetingId, kind)；索引(leaderMeetingId, capturedAt) | 關聯領隊會議 | 金流／可能個資；LeaderMeetingService |
| `kind` | `LeaderMeetingSnapshotKind`；必填 | — | 複合唯一(leaderMeetingId, kind) | 快照種類 | 金流／可能個資；LeaderMeetingService |
| `version` | `Int`；必填 | `1` | — | 版本號或文件版次 | 金流／可能個資；LeaderMeetingService |
| `amountDue` (`amount_due`) | `Int`；必填 | — | — | 擷取時的應繳金額結果 | 金流／可能個資；LeaderMeetingService |
| `capturedAt` (`captured_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | 索引(leaderMeetingId, capturedAt) | 快照擷取時間 | 金流／可能個資；LeaderMeetingService |
| `payload` | `Json (@db.JsonB)`；必填 | — | — | 基準或最終名單／財務的必要業務快照 | 金流／可能個資；LeaderMeetingService |
| `createdById` (`created_by_id`) | `String (@db.Uuid)`；必填 | — | FK→User | 建立操作者 | 個資或身分關聯；LeaderMeetingService |

## `ActivityStaff` → `activity_staff`

使用者於某年度的主辦職務；撤銷後失去該年度權限。 主要建立／更新者：[IdentityService.bootstrap](apps/api/src/identity.service.ts)／[AccountsController](apps/api/src/accounts.controller.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 個資或身分關聯；bootstrap／AccountsController |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, userId)；索引(userId, activityId, revokedAt) | 所屬年度活動；用於範圍和關聯核對 | 個資或身分關聯；bootstrap／AccountsController |
| `userId` (`user_id`) | `String (@db.Uuid)`；必填 | — | FK→User；複合唯一(activityId, userId)；索引(userId, activityId, revokedAt) | 關聯登入使用者 | 個資或身分關聯；bootstrap／AccountsController |
| `role` | `StaffRole`；必填 | — | — | 年度職務或社團成員角色 | 個資或身分關聯；bootstrap／AccountsController |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 個資或身分關聯；bootstrap／AccountsController |
| `revokedAt` (`revoked_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | 索引(userId, activityId, revokedAt) | 撤銷時間；可空代表尚未撤銷 | 個資或身分關聯；bootstrap／AccountsController |

## `Organization` → `organizations`

特定年度的社團，不跨年度共用一筆社團資料。 主要建立／更新者：[ActivityController](apps/api/src/activity.controller.ts)／[AccountsController](apps/api/src/accounts.controller.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；ActivityController／AccountsController |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, code)；索引(activityId, active) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；ActivityController／AccountsController |
| `code` | `String`；必填 | — | 複合唯一(activityId, code) | 年度內識別代碼 | 一般賽務資料；ActivityController／AccountsController |
| `name` | `String`；必填 | — | — | 顯示名稱 | 一般賽務資料；ActivityController／AccountsController |
| `shortName` (`short_name`) | `String?`；可空 | — | — | 社團簡稱 | 一般賽務資料；ActivityController／AccountsController |
| `active` | `Boolean`；必填 | `true` | 索引(activityId, active) | 目前是否有效 | 一般賽務資料；ActivityController／AccountsController |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；ActivityController／AccountsController |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；ActivityController／AccountsController |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；ActivityController／AccountsController |

## `OrganizationMembership` → `organization_memberships`

使用者於某社團的領隊或副領隊成員資格。 主要建立／更新者：[AccountsController](apps/api/src/accounts.controller.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 個資或身分關聯；AccountsController |
| `organizationId` (`organization_id`) | `String (@db.Uuid)`；必填 | — | FK→Organization；複合唯一(organizationId, userId) | 關聯社團 | 個資或身分關聯；AccountsController |
| `userId` (`user_id`) | `String (@db.Uuid)`；必填 | — | FK→User；複合唯一(organizationId, userId)；索引(userId, revokedAt) | 關聯登入使用者 | 個資或身分關聯；AccountsController |
| `role` | `OrganizationMemberRole`；必填 | — | — | 年度職務或社團成員角色 | 個資或身分關聯；AccountsController |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 個資或身分關聯；AccountsController |
| `revokedAt` (`revoked_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | 索引(userId, revokedAt) | 撤銷時間；可空代表尚未撤銷 | 個資或身分關聯；AccountsController |

## `Participant` → `participants`

有來源社團的年度選手；編入聯隊不改來源。 主要建立／更新者：[RosterController](apps/api/src/roster.controller.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 個資或身分關聯；RosterController／匯入服務 |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；索引(activityId, sourceOrganizationId, active) | 所屬年度活動；用於範圍和關聯核對 | 個資或身分關聯；RosterController／匯入服務 |
| `sourceOrganizationId` (`source_organization_id`) | `String (@db.Uuid)`；必填 | — | FK→Organization；索引(activityId, sourceOrganizationId, active) | 選手原始所屬社團 | 個資或身分關聯；RosterController／匯入服務 |
| `name` | `String`；必填 | — | — | 顯示名稱 | 個資或身分關聯；RosterController／匯入服務 |
| `gender` | `ParticipantGender`；必填 | — | — | 賽事資格使用的性別分類 | 個資或身分關聯；RosterController／匯入服務 |
| `grade` | `ParticipantGrade`；必填 | — | — | 賽事資格使用的年級 | 個資或身分關聯；RosterController／匯入服務 |
| `active` | `Boolean`；必填 | `true` | 索引(activityId, sourceOrganizationId, active) | 目前是否有效 | 個資或身分關聯；RosterController／匯入服務 |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 個資或身分關聯；RosterController／匯入服務 |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 個資或身分關聯；RosterController／匯入服務 |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 個資或身分關聯；RosterController／匯入服務 |

## `LeagueRule` → `league_rules`

特定年度聯隊資格的門檻及例外規則。 主要建立／更新者：[LeagueService](apps/api/src/league.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；LeagueService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | 唯一；FK→Activity | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；LeagueService |
| `minimumMemberClubs` (`minimum_member_clubs`) | `Int`；必填 | `2` | — | 聯隊至少包含社團數 | 一般賽務資料；LeagueService |
| `maximumMemberClubs` (`maximum_member_clubs`) | `Int?`；可空 | — | — | 聯隊最多包含社團數 | 一般賽務資料；LeagueService |
| `minimumParticipants` (`minimum_participants`) | `Int?`；可空 | — | — | 選手人數下限 | 一般賽務資料；LeagueService |
| `maximumParticipants` (`maximum_participants`) | `Int?`；可空 | — | — | 選手人數上限 | 一般賽務資料；LeagueService |
| `lowParticipantQualificationEnabled` (`low_participant_qualification_enabled`) | `Boolean`；必填 | `true` | — | 是否採選手較少的資格條件 | 一般賽務資料；LeagueService |
| `lowParticipantThreshold` (`low_participant_threshold`) | `Int?`；可空 | `15` | — | 低人數資格門檻 | 一般賽務資料；LeagueService |
| `genderImbalanceQualificationEnabled` (`gender_imbalance_qualification_enabled`) | `Boolean`；必填 | `true` | — | 是否採性別比例資格條件 | 一般賽務資料；LeagueService |
| `minorityGenderRatioPercent` (`minority_gender_ratio_percent`) | `Int?`；可空 | `25` | — | 少數性別比例門檻 | 一般賽務資料；LeagueService |
| `qualificationMode` (`qualification_mode`) | `LeagueQualificationMode`；必填 | `ANY` | — | 多項資格條件的組合方式 | 一般賽務資料；LeagueService |
| `singleGenderExceptionEnabled` (`single_gender_exception_enabled`) | `Boolean`；必填 | `true` | — | 是否開放單一性別例外 | 一般賽務資料；LeagueService |
| `singleGenderExceptionMaximumMemberClubs` (`single_gender_exception_maximum_member_clubs`) | `Int?`；可空 | — | — | 例外適用的社團數上限 | 一般賽務資料；LeagueService |
| `singleGenderExceptionMaximumParticipants` (`single_gender_exception_maximum_participants`) | `Int?`；可空 | `35` | — | 例外適用的選手數上限 | 一般賽務資料；LeagueService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；LeagueService |

## `League` → `leagues`

聯隊本體，負責社團與年度固定，成員另表管理。 主要建立／更新者：[LeagueService](apps/api/src/league.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；LeagueService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, name)；索引(activityId, status) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；LeagueService |
| `name` | `String`；必填 | — | 複合唯一(activityId, name) | 顯示名稱 | 一般賽務資料；LeagueService |
| `ownerOrganizationId` (`owner_organization_id`) | `String (@db.Uuid)`；必填 | — | FK→Organization | 發起與管理聯隊報名的負責社團 | 一般賽務資料；LeagueService |
| `status` | `LeagueStatus`；必填 | `PENDING_CONFIRMATION` | 索引(activityId, status) | 目前狀態；可用轉換由服務判定 | 一般賽務資料；LeagueService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；LeagueService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；LeagueService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；LeagueService |

## `LeagueMember` → `league_members`

社團加入聯隊的邀請／確認狀態。 主要建立／更新者：[LeagueService](apps/api/src/league.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；LeagueService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | — | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；LeagueService |
| `leagueId` (`league_id`) | `String (@db.Uuid)`；必填 | — | FK→League；複合唯一(leagueId, organizationId) | 關聯聯隊 | 一般賽務資料；LeagueService |
| `organizationId` (`organization_id`) | `String (@db.Uuid)`；必填 | — | FK→Organization；複合唯一(leagueId, organizationId)；索引(organizationId, status) | 關聯社團 | 一般賽務資料；LeagueService |
| `status` | `LeagueMemberStatus`；必填 | `PENDING` | 索引(organizationId, status) | 目前狀態；可用轉換由服務判定 | 一般賽務資料；LeagueService |
| `confirmedByUserId` (`confirmed_by_user_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 確認加入的操作者 | 個資或身分關聯；LeagueService |
| `confirmedAt` (`confirmed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 確認時間 | 一般賽務資料；LeagueService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；LeagueService |

## `Registration` → `registrations`

一個社團或一個聯隊的年度報名單位；兩種 owner 擇一。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)／[RegistrationService](apps/api/src/registration.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService／RegistrationService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, organizationId)；複合唯一(activityId, leagueId)；索引(activityId, status) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService／RegistrationService |
| `organizationId` (`organization_id`) | `String? (@db.Uuid)`；可空 | — | FK→Organization；複合唯一(activityId, organizationId) | 社團報名的 owner，與 leagueId 擇一 | 一般賽務資料；CompetitionService／RegistrationService |
| `leagueId` (`league_id`) | `String? (@db.Uuid)`；可空 | — | FK→League；複合唯一(activityId, leagueId) | 聯隊報名的 owner，與 organizationId 擇一 | 一般賽務資料；CompetitionService／RegistrationService |
| `status` | `RegistrationStatus`；必填 | `DRAFT` | 索引(activityId, status) | 目前狀態；可用轉換由服務判定 | 一般賽務資料；CompetitionService／RegistrationService |
| `submittedAt` (`submitted_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 送出時間 | 一般賽務資料；CompetitionService／RegistrationService |
| `confirmedAt` (`confirmed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 確認時間 | 一般賽務資料；CompetitionService／RegistrationService |
| `returnedAt` (`returned_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 退回時間 | 一般賽務資料；CompetitionService／RegistrationService |
| `returnReason` (`return_reason`) | `String?`；可空 | — | — | 退回補正原因 | 一般賽務資料；CompetitionService／RegistrationService |
| `totalRosterAttachmentId` (`total_roster_attachment_id`) | `String? (@db.Uuid)`；可空 | — | 唯一；FK→Attachment | 社團總參賽名單 PDF 的附件關聯 | 檔案存取；CompetitionService／RegistrationService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；CompetitionService／RegistrationService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService／RegistrationService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；CompetitionService／RegistrationService |

## `CompetitionEvent` → `competition_events`

年度賽事項目、適用報名單位、隊伍組成和容量。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, code)；索引(activityId, enabled, displayOrder) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService |
| `code` | `String`；必填 | — | 複合唯一(activityId, code) | 年度內識別代碼 | 一般賽務資料；CompetitionService |
| `name` | `String`；必填 | — | — | 顯示名稱 | 一般賽務資料；CompetitionService |
| `displayOrder` (`display_order`) | `Int`；必填 | — | 索引(activityId, enabled, displayOrder) | 頁面排序 | 一般賽務資料；CompetitionService |
| `enabled` | `Boolean`；必填 | `true` | 索引(activityId, enabled, displayOrder) | 是否啟用 | 一般賽務資料；CompetitionService |
| `minTeamSize` (`min_team_size`) | `Int?`；可空 | — | — | 每隊人數下限 | 一般賽務資料；CompetitionService |
| `maxTeamSize` (`max_team_size`) | `Int?`；可空 | — | — | 每隊人數上限 | 一般賽務資料；CompetitionService |
| `maxTeamsPerRegistration` (`max_teams_per_registration`) | `Int`；必填 | `1` | — | 每個報名單位最多隊伍數 | 一般賽務資料；CompetitionService |
| `teamCapacity` (`team_capacity`) | `Int?`；可空 | — | — | 正式錄取隊伍容量 | 一般賽務資料；CompetitionService |
| `allowClub` (`allow_club`) | `Boolean`；必填 | `true` | — | 是否接受社團報名 | 一般賽務資料；CompetitionService |
| `allowLeague` (`allow_league`) | `Boolean`；必填 | `true` | — | 是否接受聯隊報名 | 一般賽務資料；CompetitionService |
| `genderRule` (`gender_rule`) | `ParticipantGender?`；可空 | — | — | 賽事性別限制 | 一般賽務資料；CompetitionService |
| `allowedGrades` (`allowed_grades`) | `ParticipantGrade[]`；必填 | `[]` | — | 賽事允許年級陣列 | 一般賽務資料；CompetitionService |
| `rulesJson` (`rules_json`) | `Json? (@db.JsonB)`；可空 | — | — | 特殊賽事組成規則 JSON | 一般賽務資料；CompetitionService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；CompetitionService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；CompetitionService |

## `ScheduleVersion` → `schedule_versions`

年度賽程草稿／發布版本。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, version)；索引(activityId, status) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService |
| `version` | `Int`；必填 | — | 複合唯一(activityId, version) | 版本號或文件版次 | 一般賽務資料；CompetitionService |
| `status` | `ScheduleVersionStatus`；必填 | `DRAFT` | 索引(activityId, status) | 目前狀態；可用轉換由服務判定 | 一般賽務資料；CompetitionService |
| `createdById` (`created_by_id`) | `String (@db.Uuid)`；必填 | — | FK→User | 建立操作者 | 個資或身分關聯；CompetitionService |
| `publishedById` (`published_by_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 發布操作者 | 個資或身分關聯；CompetitionService |
| `publishedAt` (`published_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 發布時間 | 一般賽務資料；CompetitionService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；CompetitionService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；CompetitionService |

## `EventTimeWindow` → `event_time_windows`

某賽程版本下某賽事的具體時段。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；索引(activityId, eventId, startAt, endAt) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService |
| `scheduleVersionId` (`schedule_version_id`) | `String (@db.Uuid)`；必填 | — | FK→ScheduleVersion；複合唯一(scheduleVersionId, eventId, ordinal) | 關聯賽程版本 | 一般賽務資料；CompetitionService |
| `eventId` (`event_id`) | `String (@db.Uuid)`；必填 | — | FK→CompetitionEvent；複合唯一(scheduleVersionId, eventId, ordinal)；索引(activityId, eventId, startAt, endAt) | 關聯賽事項目 | 一般賽務資料；CompetitionService |
| `ordinal` | `Int`；必填 | `1` | 複合唯一(scheduleVersionId, eventId, ordinal) | 同一父項下的次序 | 一般賽務資料；CompetitionService |
| `startAt` (`start_at`) | `DateTime (@db.Timestamptz)`；必填 | — | 索引(activityId, eventId, startAt, endAt) | 時段開始 | 一般賽務資料；CompetitionService |
| `endAt` (`end_at`) | `DateTime (@db.Timestamptz)`；必填 | — | 索引(activityId, eventId, startAt, endAt) | 時段結束 | 一般賽務資料；CompetitionService |
| `venue` | `String?`；可空 | — | — | 場地名稱 | 一般賽務資料；CompetitionService |
| `label` | `String?`；可空 | — | — | 時段顯示標籤 | 一般賽務資料；CompetitionService |

## `EventEntry` → `event_entries`

一份報名對一項賽事的參賽紀錄。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)／[LeaderMeetingService](apps/api/src/leader-meeting.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；索引(activityId, eventId, active) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `registrationId` (`registration_id`) | `String (@db.Uuid)`；必填 | — | FK→Registration；複合唯一(registrationId, eventId) | 關聯報名單位 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `eventId` (`event_id`) | `String (@db.Uuid)`；必填 | — | FK→CompetitionEvent；複合唯一(registrationId, eventId)；索引(activityId, eventId, active) | 關聯賽事項目 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `source` | `EventEntrySource`；必填 | `REGISTRATION` | — | 原始報名或領隊會議加報 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `active` | `Boolean`；必填 | `true` | 索引(activityId, eventId, active) | 這筆賽事項目報名是否仍有效 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；CompetitionService／LeaderMeetingService |

## `Team` → `teams`

賽事項目下的 A／B 等隊伍及錄取狀態。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)／[LeaderMeetingService](apps/api/src/leader-meeting.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `eventEntryId` (`event_entry_id`) | `String (@db.Uuid)`；必填 | — | FK→EventEntry；複合唯一(eventEntryId, ordinal) | 所屬參賽項目 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `ordinal` | `Int`；必填 | — | 複合唯一(eventEntryId, ordinal) | 同一父項下的次序 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `name` | `String?`；可空 | — | — | 顯示名稱 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `admissionStatus` (`admission_status`) | `TeamAdmissionStatus`；必填 | `ADMITTED` | — | 正式錄取、待錄取或拒絕狀態 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService／LeaderMeetingService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；CompetitionService／LeaderMeetingService |

## `TeamMember` → `team_members`

選手實際編入隊伍的紀錄。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)／[RosterSuggestionService](apps/api/src/roster-suggestion.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService／名單建議套用 |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | 索引(activityId, participantId, active) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService／名單建議套用 |
| `eventEntryId` (`event_entry_id`) | `String (@db.Uuid)`；必填 | — | FK→EventEntry；複合唯一(eventEntryId, participantId) | 關聯賽事報名 | 一般賽務資料；CompetitionService／名單建議套用 |
| `teamId` (`team_id`) | `String (@db.Uuid)`；必填 | — | FK→Team | 關聯隊伍 | 一般賽務資料；CompetitionService／名單建議套用 |
| `participantId` (`participant_id`) | `String (@db.Uuid)`；必填 | — | FK→Participant；複合唯一(eventEntryId, participantId)；索引(activityId, participantId, active) | 關聯選手 | 可關聯選手資料；CompetitionService／名單建議套用 |
| `active` | `Boolean`；必填 | `true` | 索引(activityId, participantId, active) | 成員目前是否在隊 | 一般賽務資料；CompetitionService／名單建議套用 |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；CompetitionService／名單建議套用 |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService／名單建議套用 |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；CompetitionService／名單建議套用 |
| `removedAt` (`removed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 移出隊伍的時間 | 一般賽務資料；CompetitionService／名單建議套用 |

## `ParticipantEventClaim` → `participant_event_claims`

同年度、同賽事、同選手的占用歸屬，防跨報名重複。 主要建立／更新者：[CompetitionService](apps/api/src/competition.service.ts)／[RosterSuggestionService](apps/api/src/roster-suggestion.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；CompetitionService／名單建議套用 |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；複合唯一(activityId, eventId, participantId) | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；CompetitionService／名單建議套用 |
| `eventId` (`event_id`) | `String (@db.Uuid)`；必填 | — | FK→CompetitionEvent；複合唯一(activityId, eventId, participantId)；索引(registrationId, eventId) | 關聯賽事項目 | 一般賽務資料；CompetitionService／名單建議套用 |
| `participantId` (`participant_id`) | `String (@db.Uuid)`；必填 | — | FK→Participant；複合唯一(activityId, eventId, participantId)；複合唯一(eventEntryId, participantId) | 關聯選手 | 可關聯選手資料；CompetitionService／名單建議套用 |
| `registrationId` (`registration_id`) | `String (@db.Uuid)`；必填 | — | FK→Registration；索引(registrationId, eventId) | 關聯報名單位 | 一般賽務資料；CompetitionService／名單建議套用 |
| `eventEntryId` (`event_entry_id`) | `String (@db.Uuid)`；必填 | — | FK→EventEntry；複合唯一(eventEntryId, participantId) | 關聯賽事報名 | 一般賽務資料；CompetitionService／名單建議套用 |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；CompetitionService／名單建議套用 |

## `FeeSchedule` → `fee_schedules`

每年度報名基本費、選手費及預設項目費。 主要建立／更新者：[FinanceService](apps/api/src/finance.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；FinanceService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | 唯一；FK→Activity | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；FinanceService |
| `registrationBaseFee` (`registration_base_fee`) | `Int`；必填 | — | — | 每份報名的基本費 | 一般賽務資料；FinanceService |
| `participantFee` (`participant_fee`) | `Int`；必填 | — | — | 正式錄取隊伍中不重複選手的單價 | 一般賽務資料；FinanceService |
| `defaultTeamEntryFee` (`default_team_entry_fee`) | `Int`；必填 | — | — | 至少有正式錄取隊伍的賽事項目預設費 | 一般賽務資料；FinanceService |
| `updatedById` (`updated_by_id`) | `String (@db.Uuid)`；必填 | — | FK→User | 最近更新操作者 | 個資或身分關聯；FinanceService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 一般賽務資料；FinanceService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 一般賽務資料；FinanceService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 一般賽務資料；FinanceService |

## `EventFeeOverride` → `event_fee_overrides`

單項賽事覆蓋年度預設項目費。 主要建立／更新者：[FinanceService](apps/api/src/finance.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 一般賽務資料；FinanceService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity | 所屬年度活動；用於範圍和關聯核對 | 一般賽務資料；FinanceService |
| `feeScheduleId` (`fee_schedule_id`) | `String (@db.Uuid)`；必填 | — | FK→FeeSchedule；複合唯一(feeScheduleId, eventId) | 關聯年度費率 | 一般賽務資料；FinanceService |
| `eventId` (`event_id`) | `String (@db.Uuid)`；必填 | — | FK→CompetitionEvent；複合唯一(feeScheduleId, eventId) | 關聯賽事項目 | 一般賽務資料；FinanceService |
| `teamEntryFee` (`team_entry_fee`) | `Int`；必填 | — | — | 指定賽事的項目費覆蓋值 | 一般賽務資料；FinanceService |

## `Attachment` → `attachments`

私有檔案的中繼資料；位元組由檔案儲存服務管理。 主要建立／更新者：[FinanceService](apps/api/src/finance.service.ts)／[proof-storage](apps/api/src/proof-storage.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 檔案存取；FinanceService／proof-storage |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；索引(activityId, purpose, createdAt) | 所屬年度活動；用於範圍和關聯核對 | 檔案存取；FinanceService／proof-storage |
| `uploadedById` (`uploaded_by_id`) | `String (@db.Uuid)`；必填 | — | FK→User | 上傳者 | 個資或身分關聯；FinanceService／proof-storage |
| `purpose` | `AttachmentPurpose`；必填 | — | 索引(activityId, purpose, createdAt) | 付款證明或總名單用途 | 檔案存取；FinanceService／proof-storage |
| `storageKey` (`storage_key`) | `String`；必填 | — | 唯一 | 私有檔案目錄中的定位鍵 | 檔案存取；FinanceService／proof-storage |
| `originalName` (`original_name`) | `String`；必填 | — | — | 上傳時的檔名 | 檔案存取；FinanceService／proof-storage |
| `mimeType` (`mime_type`) | `String`；必填 | — | — | 宣告的檔案媒體型別 | 檔案存取；FinanceService／proof-storage |
| `sizeBytes` (`size_bytes`) | `Int`；必填 | — | — | 檔案位元組數 | 檔案存取；FinanceService／proof-storage |
| `sha256` | `String`；必填 | — | — | 檔案內容 SHA-256 摘要 | 檔案存取；FinanceService／proof-storage |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | 索引(activityId, purpose, createdAt) | 建立時間 | 檔案存取；FinanceService／proof-storage |

## `Payment` → `payments`

報名單位提交的付款紀錄及主辦審核狀態。 主要建立／更新者：[FinanceService](apps/api/src/finance.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 金流／可能個資；FinanceService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；索引(activityId, status) | 所屬年度活動；用於範圍和關聯核對 | 金流／可能個資；FinanceService |
| `registrationId` (`registration_id`) | `String (@db.Uuid)`；必填 | — | FK→Registration；索引(registrationId, status, paidAt) | 關聯報名單位 | 金流／可能個資；FinanceService |
| `amount` | `Int`；必填 | — | — | 提交或申請的金額 | 金流／可能個資；FinanceService |
| `paidAt` (`paid_at`) | `DateTime (@db.Timestamptz)`；必填 | — | 索引(registrationId, status, paidAt) | 使用者填報的付款時間 | 金流／可能個資；FinanceService |
| `payerName` (`payer_name`) | `String?`；可空 | — | — | 填報付款人姓名 | 金流／可能個資；FinanceService |
| `bankAccountLastFive` (`bank_account_last_five`) | `String?`；可空 | — | — | 填報帳號末五碼 | 金流／可能個資；FinanceService |
| `reference` | `String?`；可空 | — | — | 付款參考資訊 | 金流／可能個資；FinanceService |
| `status` | `PaymentStatus`；必填 | `SUBMITTED` | 索引(registrationId, status, paidAt)；索引(activityId, status) | 目前狀態；可用轉換由服務判定 | 金流／可能個資；FinanceService |
| `proofAttachmentId` (`proof_attachment_id`) | `String? (@db.Uuid)`；可空 | — | FK→Attachment | 可選付款證明附件 | 檔案存取；FinanceService |
| `submittedByUserId` (`submitted_by_user_id`) | `String (@db.Uuid)`；必填 | — | FK→User | 提交付款者 | 個資或身分關聯；FinanceService |
| `reviewedByUserId` (`reviewed_by_user_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 審核者 | 個資或身分關聯；FinanceService |
| `reviewedAt` (`reviewed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 審核時間 | 金流／可能個資；FinanceService |
| `reviewNote` (`review_note`) | `String?`；可空 | — | — | 審核備註；可記錄填報的實收金額文字 | 金流／可能個資；FinanceService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 金流／可能個資；FinanceService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 金流／可能個資；FinanceService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 金流／可能個資；FinanceService |

## `Refund` → `refunds`

報名單位退款申請與主辦完成／取消狀態。 主要建立／更新者：[FinanceService](apps/api/src/finance.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 金流／可能個資；FinanceService |
| `activityId` (`activity_id`) | `String (@db.Uuid)`；必填 | — | FK→Activity；索引(activityId, status) | 所屬年度活動；用於範圍和關聯核對 | 金流／可能個資；FinanceService |
| `registrationId` (`registration_id`) | `String (@db.Uuid)`；必填 | — | FK→Registration；索引(registrationId, status) | 關聯報名單位 | 金流／可能個資；FinanceService |
| `amount` | `Int`；必填 | — | — | 提交或申請的金額 | 金流／可能個資；FinanceService |
| `reason` | `String`；必填 | — | — | 作業理由 | 金流／可能個資；FinanceService |
| `status` | `RefundStatus`；必填 | `REQUESTED` | 索引(registrationId, status)；索引(activityId, status) | 目前狀態；可用轉換由服務判定 | 金流／可能個資；FinanceService |
| `createdByUserId` (`created_by_user_id`) | `String (@db.Uuid)`；必填 | — | FK→User | 提出退款者 | 個資或身分關聯；FinanceService |
| `completedByUserId` (`completed_by_user_id`) | `String? (@db.Uuid)`；可空 | — | FK→User | 完成退款的承辦人 | 個資或身分關聯；FinanceService |
| `completedAt` (`completed_at`) | `DateTime? (@db.Timestamptz)`；可空 | — | — | 完成時間 | 金流／可能個資；FinanceService |
| `rowVersion` (`row_version`) | `Int`；必填 | `1` | — | 樂觀並行版本；更新時比對並遞增 | 金流／可能個資；FinanceService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | — | 建立時間 | 金流／可能個資；FinanceService |
| `updatedAt` (`updated_at`) | `DateTime (@db.Timestamptz)`；必填 | Prisma @updatedAt | — | 最近更新時間 | 金流／可能個資；FinanceService |

## `LoginAttempt` → `login_attempts`

短時間帳號、來源及全站登入次數計數。 主要建立／更新者：[IdentityService](apps/api/src/identity.service.ts)；完整關聯方向仍以 schema 為準。

| Prisma 欄位（SQL 欄名） | 型別／可空 | 預設 | 鍵、關聯、索引 | 業務用途 | 敏感度；寫入者 |
| --- | --- | --- | --- | --- | --- |
| `id` | `String (@db.Uuid)`；必填 | `dbgenerated("gen_random_uuid()")` | PK | 資料列識別碼 | 認證／個資；IdentityService |
| `accountKey` (`account_key`) | `String`；必填 | — | 索引(accountKey, createdAt) | 登入帳號的雜湊限流鍵 | 認證／個資；IdentityService |
| `sourceKey` (`source_key`) | `String`；必填 | — | 索引(sourceKey, createdAt) | 來源位址的雜湊限流鍵 | 認證／個資；IdentityService |
| `createdAt` (`created_at`) | `DateTime (@db.Timestamptz)`；必填 | `now()` | 索引(accountKey, createdAt)；索引(sourceKey, createdAt)；索引(createdAt) | 建立時間 | 認證／個資；IdentityService |

## 關係與衍生資料

- **年度隔離：**`Activity.year` 與 `code` 唯一；年度社團、名單、賽事、報名、帳號指派均帶活動關聯。`User` 可跨年度存在，但 `ActivityStaff` 和社團 `OrganizationMembership` 的有效指派按當年度檢查。
- **來源與聯隊：**`Participant.sourceOrganizationId` 是來源社團；`LeagueMember.status=CONFIRMED` 才納入聯隊選手資格。`League.ownerOrganizationId` 是發起／負責社團，不能把所有受邀社團都視為聯隊修改者。
- **參賽鏈：**`Registration` → `EventEntry` → `Team` → `TeamMember` 保存報名、項目、隊伍和配置；`ParticipantEventClaim` 的 `(activityId,eventId,participantId)` 唯一鍵擋跨報名重複占用，服務同步維護實際隊伍與占用。`TeamMember.participantId` 與 `ParticipantEventClaim.participantId` 可關聯至選手資料，匯出及查詢仍須按年度和報名範圍授權。
- **費用：**`FeeSchedule` 保存年度預設項目費；`EventFeeOverride` 的個別設定優先於該預設值（零元也有效），兩者共同保存收費規則；`Payment`／`Refund` 保存實際提交與審核。應繳、淨實收、差額由 [FinanceCalculationService](apps/api/src/finance-calculation.service.ts)計算，不是 `Registration` 的實體欄位。
- **快照與附件：**`LeaderMeetingSnapshot.payload` 保存會議基準與結束時必要的業務資料。`Attachment.storageKey` 只是私有檔案定位鍵，實際位元組由 [proof-storage](apps/api/src/proof-storage.ts)放在部署者管理的檔案目錄。

## 應用檢查與資料庫最後保護

| 資料規則 | 應用服務檢查 | DB 最後保護（初始化 SQL） |
| --- | --- | --- |
| 年度、社團、聯隊和跨表連結一致 | [IdentityService](apps/api/src/identity.service.ts)及各服務按年度／物件重查權限與來源 | FK；`gokan_check_participant_activity`、`gokan_check_league_activity`、`gokan_check_league_member_activity` 等 trigger，比對相連資料的年度。 |
| 報名 owner 與狀態 | [RegistrationService](apps/api/src/registration.service.ts)控制送審／退回／確認 | `registrations_owner_xor_check` 要求社團或聯隊擇一；各 owner 複合唯一、狀態欄位 CHECK；跨年度報名 trigger。 |
| 賽事、時段及正式發布 | [CompetitionService](apps/api/src/competition.service.ts)檢查資格、場地／選手時間衝突、已發布版本 | 賽事人數／容量／報名單位 CHECK、時段 `start_at < end_at`；每年度僅一個已發布賽程的部分唯一索引及時段關聯 trigger。時間衝突本身仍靠服務判斷。 |
| 隊伍與選手占用 | 服務在加入、移除、替換時維護隊伍與 claim，依階段、來源及資格驗證 | FK、隊伍次序／移除狀態 CHECK、`(activity_id,event_id,participant_id)` 唯一鍵；`gokan_check_team_member_links`／`gokan_check_participant_event_claim_links` trigger。 |
| 費率、付款、退款 | [FinanceService](apps/api/src/finance.service.ts)檢查權限、金額、狀態及版本 | 費率／付款／退款非負或正數 CHECK、審核與完成狀態 CHECK、唯一費率設定、相關年度 trigger。即時應繳由服務計算，不直接存入 `Registration`；`LeaderMeetingSnapshot.amountDue` 保存擷取時的計算結果。 |
| 附件 | 上傳服務驗格式、大小、用途、授權；下載再查報名範圍 | FK、`storage_key` 唯一、大小／SHA-256／允許 MIME CHECK、跨年度付款與附件 trigger；DB 不存位元組，也不取代惡意內容掃描。 |
| 登入與告知 | [IdentityService](apps/api/src/identity.service.ts)比對密碼、限流、Session 到期及同意 | `Session.tokenHash` 唯一、`User.normalizedEmail` 唯一、使用者／政策 FK、`UserConsent(userId,policyDocumentId)` 複合唯一及 `LoginAttempt` 時間索引。 |

SQL trigger 名稱和條件可在 [migration](packages/database/prisma/migrations/001_initial/migration.sql) 查核；這些約束保護資料底線，不能替代應用的權限、活動階段或完整業務驗證。
