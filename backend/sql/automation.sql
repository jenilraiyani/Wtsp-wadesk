IF OBJECT_ID('dbo.AutomationRules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AutomationRules (
        Id NVARCHAR(40) NOT NULL PRIMARY KEY,
        Name NVARCHAR(200) NOT NULL,
        DeviceId NVARCHAR(40) NOT NULL,
        MatchType NVARCHAR(20) NOT NULL CONSTRAINT DF_AutomationRules_MatchType DEFAULT 'contains',
        Keywords NVARCHAR(MAX) NOT NULL,
        ReplyMessage NVARCHAR(MAX) NOT NULL,
        Variables NVARCHAR(MAX) NULL,
        Options NVARCHAR(MAX) NULL,
        AttachmentName NVARCHAR(260) NULL,
        WorkingHours NVARCHAR(MAX) NULL,
        Priority INT NOT NULL CONSTRAINT DF_AutomationRules_Priority DEFAULT 0,
        IsActive BIT NOT NULL CONSTRAINT DF_AutomationRules_IsActive DEFAULT 1,
        UserId NVARCHAR(40) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AutomationRules_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AutomationRules_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_AutomationRules_Device ON dbo.AutomationRules (DeviceId, IsActive, Priority DESC);
END
GO

IF COL_LENGTH('dbo.AutomationRules', 'Variables') IS NULL
    ALTER TABLE dbo.AutomationRules ADD Variables NVARCHAR(MAX) NULL;
GO

IF COL_LENGTH('dbo.AutomationRules', 'Options') IS NULL
    ALTER TABLE dbo.AutomationRules ADD Options NVARCHAR(MAX) NULL;
GO

IF COL_LENGTH('dbo.AutomationRules', 'AttachmentName') IS NULL
    ALTER TABLE dbo.AutomationRules ADD AttachmentName NVARCHAR(260) NULL;
GO

IF COL_LENGTH('dbo.AutomationRules', 'WorkingHours') IS NULL
    ALTER TABLE dbo.AutomationRules ADD WorkingHours NVARCHAR(MAX) NULL;
GO

IF OBJECT_ID('dbo.AutomationLogs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AutomationLogs (
        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RuleId NVARCHAR(40) NULL,
        RuleName NVARCHAR(200) NULL,
        DeviceId NVARCHAR(40) NOT NULL,
        ChatId NVARCHAR(80) NOT NULL,
        ContactName NVARCHAR(120) NULL,
        IncomingText NVARCHAR(4000) NULL,
        MatchedKeyword NVARCHAR(200) NULL,
        ReplyText NVARCHAR(MAX) NULL,
        Status NVARCHAR(20) NOT NULL,
        ErrorMessage NVARCHAR(800) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AutomationLogs_CreatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_AutomationLogs_Device_Created ON dbo.AutomationLogs (DeviceId, CreatedAt DESC);
    CREATE INDEX IX_AutomationLogs_Rule ON dbo.AutomationLogs (RuleId, CreatedAt DESC);
END
GO
