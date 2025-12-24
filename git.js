// Refrence blog https://kushagra.dev/blog/build-git-learn-git/

// Creating a repo
function Git(name) {
    this.name = name; // Repo name 
    this.lastCommitId = -1; // keep the track of last commit id
    this.branches = []; // List of all branches

    var master = new Branch("master", null); // No commits yet, so null is passed
    this.branches.push(master); // Store master branch

    this.HEAD = master; // HEAD points to current branch
}

// Commit
function Commit(id, parent, message) {
    this.id = id;
    this.parent = parent;
    this.message = message;
}

Git.prototype.commit = function(message) {
    var commit = new Commit(++this.lastCommitId, this.HEAD, message);
    this.HEAD.commit = commit;
    return commit;
}

// Commit history
Git.prototype.log = function() {
    var commit = this.HEAD.commit,
    history = [];

    while (commit) {
        history.push(commit);
        commit = commit.parent;
    }
    return history;
}

// Branches 
function Branch(name , commit) {
    this.name = name;
    this.commit = commit;
}

Git.prototype.checkout = function (branchName) {
    // Loop through all branches and see if we have a branch called branchName
    for(var i = this.branches.length; i--; ){
        if(this.branches[i].name === branchName){
            // We found an existing branch
            console.log("Switched to existing branch:" + branchName);
            this.HEAD = this.branches[i];
            return this;
        }
    }

    // If branch was not found, create a new one
    var newBranch = new Branch(branchName, this.HEAD.commit);
    // Store branch
    this.branches.push(newBranch);
    // Update HEAD
    this.HEAD = newBranch;

    console.log("Siteched to new branch: " + branchName)
    return this;
}
