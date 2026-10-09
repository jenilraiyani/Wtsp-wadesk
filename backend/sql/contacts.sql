IF OBJECT_ID('dbo.Contacts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Contacts (
        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UserId NVARCHAR(40) NOT NULL,
        Phone NVARCHAR(20) NOT NULL,
        Name NVARCHAR(200) NULL,
        Fields NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Contacts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Contacts_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_Contacts_User_Phone ON dbo.Contacts (UserId, Phone);
END
GO

IF OBJECT_ID('dbo.ContactGroups', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ContactGroups (
        Id NVARCHAR(40) NOT NULL PRIMARY KEY,
        UserId NVARCHAR(40) NOT NULL,
        Name NVARCHAR(120) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ContactGroups_CreatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_ContactGroups_User_Name ON dbo.ContactGroups (UserId, Name);
END
GO

IF OBJECT_ID('dbo.ContactGroupMembers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ContactGroupMembers (
        GroupId NVARCHAR(40) NOT NULL,
        ContactId BIGINT NOT NULL,
        CONSTRAINT PK_ContactGroupMembers PRIMARY KEY (GroupId, ContactId)
    );
    CREATE INDEX IX_ContactGroupMembers_Contact ON dbo.ContactGroupMembers (ContactId);
END
GO
