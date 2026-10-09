IF OBJECT_ID('dbo.MessageTemplates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MessageTemplates (
        Id NVARCHAR(40) NOT NULL PRIMARY KEY,
        UserId NVARCHAR(40) NOT NULL,
        Name NVARCHAR(200) NOT NULL,
        Body NVARCHAR(MAX) NULL,
        ImageName NVARCHAR(260) NULL,
        FileName NVARCHAR(260) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_MessageTemplates_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_MessageTemplates_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_MessageTemplates_User ON dbo.MessageTemplates (UserId, CreatedAt);
END
GO
