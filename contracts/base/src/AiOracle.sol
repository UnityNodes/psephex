// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAiOracle, IAiOracleClient, MAX_QUESTION_BYTES} from "./IAiOracle.sol";

contract AiOracle is IAiOracle {
    uint256 public constant DEFAULT_CALLBACK_GAS_LIMIT = 200_000;
    uint256 public constant MIN_CALLBACK_GAS_LIMIT = 50_000;
    uint256 public constant MAX_CALLBACK_GAS_LIMIT = 1_000_000;
    uint256 public constant CALLBACK_GAS_OVERHEAD = 5_000;
    uint256 public constant MAX_FEE = 0.01 ether;

    address public owner;
    address public oracle;
    uint256 public lastId;
    uint256 public callbackGasLimit;
    uint256 public fee;

    mapping(uint256 => Request) private _requests;

    error OnlyOwner();
    error OnlyOracle();
    error ZeroAddress();
    error UnknownRequest(uint256 id);
    error AlreadyFulfilled(uint256 id);
    error QuestionHashMismatch(bytes32 expected, bytes32 provided);
    error InvalidAnswer(uint8 answer);
    error WithdrawFailed();
    error InsufficientFee(uint256 required, uint256 provided);
    error QuestionTooLong(uint256 length, uint256 max);
    error FeeTooHigh(uint256 fee, uint256 max);
    error CallbackGasLimitOutOfRange(uint256 limit);
    error InsufficientGasForCallback(uint256 available, uint256 required);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address oracle_, address owner_, uint256 fee_) {
        if (oracle_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (fee_ > MAX_FEE) revert FeeTooHigh(fee_, MAX_FEE);
        oracle = oracle_;
        owner = owner_;
        callbackGasLimit = DEFAULT_CALLBACK_GAS_LIMIT;
        fee = fee_;
        emit OracleUpdated(address(0), oracle_);
        emit OwnershipTransferred(address(0), owner_);
        emit FeeUpdated(0, fee_);
    }

    function maxQuestionBytes() external pure returns (uint256) {
        return MAX_QUESTION_BYTES;
    }

    function setFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_FEE) revert FeeTooHigh(newFee, MAX_FEE);
        emit FeeUpdated(fee, newFee);
        fee = newFee;
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function setCallbackGasLimit(uint256 newLimit) external onlyOwner {
        if (newLimit < MIN_CALLBACK_GAS_LIMIT || newLimit > MAX_CALLBACK_GAS_LIMIT) {
            revert CallbackGasLimitOutOfRange(newLimit);
        }
        emit CallbackGasLimitUpdated(callbackGasLimit, newLimit);
        callbackGasLimit = newLimit;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function withdraw(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    function ask(string calldata question) external payable returns (uint256 id) {
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        uint256 length = bytes(question).length;
        if (length > MAX_QUESTION_BYTES) revert QuestionTooLong(length, MAX_QUESTION_BYTES);
        id = ++lastId;
        bytes32 questionHash = keccak256(bytes(question));
        _requests[id] = Request({requester: msg.sender, questionHash: questionHash, fulfilled: false});
        emit Asked(id, msg.sender, question, questionHash, msg.value);
    }

    function fulfill(uint256 id, uint8 answer, bytes32 questionHash) external {
        if (msg.sender != oracle) revert OnlyOracle();
        Request storage req = _requests[id];
        if (req.requester == address(0)) revert UnknownRequest(id);
        if (req.fulfilled) revert AlreadyFulfilled(id);
        if (req.questionHash != questionHash) revert QuestionHashMismatch(req.questionHash, questionHash);
        if (answer > uint8(Answer.NO)) revert InvalidAnswer(answer);

        req.fulfilled = true;
        emit Fulfilled(id, answer);

        address requester = req.requester;
        if (requester.code.length > 0) {
            _requireCallbackGas();
            try IAiOracleClient(requester).onAnswer{gas: callbackGasLimit}(id, answer) {}
            catch {
                emit CallbackFailed(id);
            }
        }
    }

    /// @dev The EVM forwards at most 63/64 of the remaining gas. Without this check a fulfill
    /// sent with too little gas starves onAnswer, the failure is swallowed as CallbackFailed and
    /// the request stays fulfilled forever, so the answer can never reach the requester.
    function _requireCallbackGas() private view {
        uint256 required = callbackGasLimit + callbackGasLimit / 63 + CALLBACK_GAS_OVERHEAD;
        uint256 available = gasleft();
        if (available < required) revert InsufficientGasForCallback(available, required);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }
}
